quiver.md

On this page
Quickstart
Create an API key, send your first request, and validate your API setup.

Use this guide when integrating with api.quiver.ai.

If you are working directly in app.quiver.ai, start with the App docs.

Before you begin
Create a QuiverAI public beta account at quiver.ai/start, then sign in to app.quiver.ai.

Create an API key

Open API Keys in the Developer Platform.
Click Create API key and give it a name.
Copy the key immediately. It is shown only once and cannot be retrieved later.
In API Keys, you can also verify whether a key is active and see its latest usage timestamp.

The QuiverAI API uses bearer authentication:

Authorization: Bearer <QUIVERAI_API_KEY>

Never commit API keys to source control.

Create new API key

Store the key in your environment

Save the key as QUIVERAI_API_KEY.


macOS/Linux

Windows
export QUIVERAI_API_KEY="<your-key>"

Install the SDK

For Node.js, use the official Node.js SDK:


npm

yarn

pnpm
npm install @quiverai/sdk

Send your first request


Node.js SDK

REST API
import { QuiverAI } from "@quiverai/sdk";

const client = new QuiverAI({
  bearerAuth: process.env["QUIVERAI_API_KEY"],
});

const logo = await client.createSVGs.generateSVG({
  model: "arrow-1.1",
  prompt: "A logo for the next AI design startup",
  instructions: "Use clean geometry, balanced spacing, and production-ready SVG structure.",
});

process.stdout.write(`${JSON.stringify(logo, null, 2)}\n`);

To choose from models available to your organization, call GET /v1/models. Arrow 1.1 is the default recommendation for most integrations. Use Arrow 1.1 Max when higher output fidelity is worth the additional cost and runtime, especially for dense illustrations, technical diagrams, and other detail-sensitive SVGs.

Next steps
Review the API reference.
List available models with GET /v1/models.
See pricing and plans.
Explore models: Text to SVG and Image to SVG.

Introduction
Authentication, base URL, endpoints, and error behavior for the QuiverAI API.

This section covers the API at api.quiver.ai.

If you are using the app at app.quiver.ai, start with the App docs.

Authentication
The QuiverAI API uses API keys with bearer authentication.

Create and manage keys in the Developer Platform under API Keys.
Follow the Quickstart to run your first call.
Keep keys server-side and load them from environment variables or secret managers.
Authorization: Bearer <QUIVERAI_API_KEY>

Base URL and headers
Send API requests to:

https://api.quiver.ai/v1

Use these headers on JSON requests:

Authorization: Bearer <QUIVERAI_API_KEY>
Content-Type: application/json

When stream is false, SVG endpoints return JSON with id, created, data, and credits. Deprecated usage token fields may still appear for compatibility. When stream is true, the endpoints return text/event-stream with reasoning, draft, and content events, followed by data: [DONE].

Core endpoints
GET /v1/models
GET /v1/models/{model}
POST /v1/svgs/generations
POST /v1/svgs/vectorizations
Billing and usage records
Current released models include Arrow 1.0, Arrow 1.1, and Arrow 1.1 Max. Arrow 1.1 is the default recommendation for most API use cases; Arrow 1.1 Max trades more runtime and credits for higher output fidelity.
Usage is billed in pricing credits. Each model lists pricing_credits (svg_generate, svg_vectorize) from GET /v1/models (and GET /v1/models/{model}).
Successful generations debit n × svg_generate credits (n defaults to 1).
Successful vectorizations debit svg_vectorize credits once per request.
Monthly app subscription credits are not API balance and cannot be spent through api.quiver.ai.
For purchase limits, defaults, and legacy model.pricing fields, see API pricing.
In Usage, API calls appear with a request ID.
Errors and rate limits
The API returns standard HTTP status codes and a JSON error payload.

Rate limits resolve from the caller’s current organization, Project, operation class, and model-operation capacity. Read the response headers as one binding ceiling:

X-RateLimit-Limit: maximum requests in the current window.
X-RateLimit-Remaining: requests remaining in the current window.
X-RateLimit-Reset: Unix timestamp in milliseconds when the current window resets.
X-RateLimit-Scope: organization, project, operation_class, or model_operation.
X-RateLimit-Dimension: request_rate or operation_throughput.
X-RateLimit-Subject: customer-safe binding label; omitted for an organization-scoped ceiling.
Retry-After: seconds to wait before retrying a 429 response.
{
  "status": 429,
  "code": "rate_limit_exceeded",
  "message": "Rate limit exceeded",
  "request_id": "550e8400-e29b-41d4-a716-446655440000"
}

400 Bad Request: malformed body, missing required fields, or invalid parameter values.
401 Unauthorized: API key missing, malformed, revoked, otherwise invalid, or the organization could not be resolved for billing. Machine-readable codes include invalid_api_key and unauthorized.
402 Payment Required: insufficient credits. Purchase more at Billing.
403 Forbidden: frozen accounts return the account_frozen code.
404 Not Found: the requested model does not exist.
429 Too Many Requests: rate limit exceeded. Retry after the number of seconds in Retry-After.
500 Internal Server Error: unexpected server error.
502 Bad Gateway: server error while processing the request.
503 Service Unavailable: server error while processing the request.
Use exponential backoff for retries and respect Retry-After when present.

SDKs
QuiverAI provides an official Node.js SDK:

npm install @quiverai/sdk

For other languages, call the REST API directly.

Models
Get Model
Returns metadata for a single model.

GET
/v1/models/{model}
Authorization
Authorization
Bearer token · header
required
Authentication via Bearer token API key
Path parameters
model
string
required
Model identifier
min length 1
Responses
200
Model details
context_length
integer
created
integer
required
min 0
description
string
id
string
required
min length 1
input_modalities
string[]
max_output_length
integer
name
string
object
string
required
Allowed:
model
output_modalities
string[]
owned_by
string
required
pricing
object
deprecated
Deprecated. Prefer `pricing_credits` for per-request credit debits. USD strings are legacy placeholders.
pricing_credits
object
supported_operations
string[]
supported_sampling_parameters
string[]
400
Bad request – malformed body, missing required fields, or invalid parameter values.
code
string
required
Allowed:
invalid_request
invalid_api_key
unauthorized
insufficient_credits
account_frozen
content_policy_violation
model_not_found
payload_too_large
request_timeout
rate_limit_exceeded
operation_rate_limit_exceeded
weekly_limit_exceeded
server_error
model_error
model_unavailable
message
string
required
min length 1
request_id
string
required
min length 1
status
integer
required
min 400 · max 599
401
Unauthorized – missing, malformed, revoked, otherwise invalid API credentials, or an organization that could not be resolved for billing.
code
string
required
Allowed:
invalid_request
invalid_api_key
unauthorized
insufficient_credits
account_frozen
content_policy_violation
model_not_found
payload_too_large
request_timeout
rate_limit_exceeded
operation_rate_limit_exceeded
weekly_limit_exceeded
server_error
model_error
model_unavailable
message
string
required
min length 1
request_id
string
required
min length 1
status
integer
required
min 400 · max 599
402
Payment required – the organization has insufficient credits.
code
string
required
Allowed:
invalid_request
invalid_api_key
unauthorized
insufficient_credits
account_frozen
content_policy_violation
model_not_found
payload_too_large
request_timeout
rate_limit_exceeded
operation_rate_limit_exceeded
weekly_limit_exceeded
server_error
model_error
model_unavailable
message
string
required
min length 1
request_id
string
required
min length 1
status
integer
required
min 400 · max 599
403
Forbidden – the account is frozen, the request is not allowed, or content policy rejected the request.
code
string
required
Allowed:
invalid_request
invalid_api_key
unauthorized
insufficient_credits
account_frozen
content_policy_violation
model_not_found
payload_too_large
request_timeout
rate_limit_exceeded
operation_rate_limit_exceeded
weekly_limit_exceeded
server_error
model_error
model_unavailable
message
string
required
min length 1
request_id
string
required
min length 1
status
integer
required
min 400 · max 599
404
Not found – the requested model does not exist.
code
string
required
Allowed:
invalid_request
invalid_api_key
unauthorized
insufficient_credits
account_frozen
content_policy_violation
model_not_found
payload_too_large
request_timeout
rate_limit_exceeded
operation_rate_limit_exceeded
weekly_limit_exceeded
server_error
model_error
model_unavailable
message
string
required
min length 1
request_id
string
required
min length 1
status
integer
required
min 400 · max 599
408
Request timeout – the request exceeded an allowed client-facing deadline.
code
string
required
Allowed:
invalid_request
invalid_api_key
unauthorized
insufficient_credits
account_frozen
content_policy_violation
model_not_found
payload_too_large
request_timeout
rate_limit_exceeded
operation_rate_limit_exceeded
weekly_limit_exceeded
server_error
model_error
model_unavailable
message
string
required
min length 1
request_id
string
required
min length 1
status
integer
required
min 400 · max 599
413
Payload too large – the submitted prompt, image, or SVG input is too large.
code
string
required
Allowed:
invalid_request
invalid_api_key
unauthorized
insufficient_credits
account_frozen
content_policy_violation
model_not_found
payload_too_large
request_timeout
rate_limit_exceeded
operation_rate_limit_exceeded
weekly_limit_exceeded
server_error
model_error
model_unavailable
message
string
required
min length 1
request_id
string
required
min length 1
status
integer
required
min 400 · max 599
429
Rate limit exceeded – too many requests. The `code` field distinguishes the dimension: `rate_limit_exceeded` for the overall request rate, `operation_rate_limit_exceeded` for a single operation's throughput. Retry after the period indicated in the `Retry-After` header.
code
string
required
Allowed:
invalid_request
invalid_api_key
unauthorized
insufficient_credits
account_frozen
content_policy_violation
model_not_found
payload_too_large
request_timeout
rate_limit_exceeded
operation_rate_limit_exceeded
weekly_limit_exceeded
server_error
model_error
model_unavailable
message
string
required
min length 1
request_id
string
required
min length 1
status
integer
required
min 400 · max 599
500
The request could not be completed. Please retry.
code
string
required
Allowed:
invalid_request
invalid_api_key
unauthorized
insufficient_credits
account_frozen
content_policy_violation
model_not_found
payload_too_large
request_timeout
rate_limit_exceeded
operation_rate_limit_exceeded
weekly_limit_exceeded
server_error
model_error
model_unavailable
message
string
required
min length 1
request_id
string
required
min length 1
status
integer
required
min 400 · max 599
502
Bad gateway – model execution returned an invalid or failed response.
code
string
required
Allowed:
invalid_request
invalid_api_key
unauthorized
insufficient_credits
account_frozen
content_policy_violation
model_not_found
payload_too_large
request_timeout
rate_limit_exceeded
operation_rate_limit_exceeded
weekly_limit_exceeded
server_error
model_error
model_unavailable
message
string
required
min length 1
request_id
string
required
min length 1
status
integer
required
min 400 · max 599
503
Service unavailable – model execution is temporarily unavailable.
code
string
required
Allowed:
invalid_request
invalid_api_key
unauthorized
insufficient_credits
account_frozen
content_policy_violation
model_not_found
payload_too_large
request_timeout
rate_limit_exceeded
operation_rate_limit_exceeded
weekly_limit_exceeded
server_error
model_error
model_unavailable
message
string
required
min length 1
request_id
string
required
min length 1
status
integer
required
min 400 · max 599
504
Gateway timeout – model execution exceeded the server deadline.
code
string
required
Allowed:
invalid_request
invalid_api_key
unauthorized
insufficient_credits
account_frozen
content_policy_violation
model_not_found
payload_too_large
request_timeout
rate_limit_exceeded
operation_rate_limit_exceeded
weekly_limit_exceeded
server_error
model_error
model_unavailable
message
string
required
min length 1
request_id
string
required
min length 1
status
integer
required
min 400 · max 599
Request
cURL
JavaScript
Python
Copy
curl -X GET "https://api.quiver.ai/v1/models/arrow-1.1" \
  -H "Authorization: Bearer YOUR_TOKEN"
Response
200
400
401
402
403
404
408
413
429
500
502
503
504
{
  "context_length": 0,
  "created": 0,
  "description": "string",
  "id": "string",
  "input_modalities": [
    "text"
  ],
  "max_output_length": 0,
  "name": "string",
  "object": "model",
  "output_modalities": [
    "text"
  ],
  "owned_by": "string",
  "pricing": {
    "svg_generate": "0.30",
    "svg_vectorize": "0.30"
  },
  "pricing_credits": {
    "svg_generate": 30,
    "svg_vectorize": 30
  },
  "supported_operations": [
    "svg_generate"
  ],
  "supported_sampling_parameters": [
    "temperature"
  ]
}

Models
List Models
Returns all models available to the authenticated organization.

GET
/v1/models
Authorization
Authorization
Bearer token · header
required
Authentication via Bearer token API key
Responses
200
List available models
data
Model[]
required
object
string
required
Allowed:
list
400
Bad request – malformed body, missing required fields, or invalid parameter values.
code
string
required
Allowed:
invalid_request
invalid_api_key
unauthorized
insufficient_credits
account_frozen
content_policy_violation
model_not_found
payload_too_large
request_timeout
rate_limit_exceeded
operation_rate_limit_exceeded
weekly_limit_exceeded
server_error
model_error
model_unavailable
message
string
required
min length 1
request_id
string
required
min length 1
status
integer
required
min 400 · max 599
401
Unauthorized – missing, malformed, revoked, otherwise invalid API credentials, or an organization that could not be resolved for billing.
code
string
required
Allowed:
invalid_request
invalid_api_key
unauthorized
insufficient_credits
account_frozen
content_policy_violation
model_not_found
payload_too_large
request_timeout
rate_limit_exceeded
operation_rate_limit_exceeded
weekly_limit_exceeded
server_error
model_error
model_unavailable
message
string
required
min length 1
request_id
string
required
min length 1
status
integer
required
min 400 · max 599
402
Payment required – the organization has insufficient credits.
code
string
required
Allowed:
invalid_request
invalid_api_key
unauthorized
insufficient_credits
account_frozen
content_policy_violation
model_not_found
payload_too_large
request_timeout
rate_limit_exceeded
operation_rate_limit_exceeded
weekly_limit_exceeded
server_error
model_error
model_unavailable
message
string
required
min length 1
request_id
string
required
min length 1
status
integer
required
min 400 · max 599
403
Forbidden – the account is frozen, the request is not allowed, or content policy rejected the request.
code
string
required
Allowed:
invalid_request
invalid_api_key
unauthorized
insufficient_credits
account_frozen
content_policy_violation
model_not_found
payload_too_large
request_timeout
rate_limit_exceeded
operation_rate_limit_exceeded
weekly_limit_exceeded
server_error
model_error
model_unavailable
message
string
required
min length 1
request_id
string
required
min length 1
status
integer
required
min 400 · max 599
408
Request timeout – the request exceeded an allowed client-facing deadline.
code
string
required
Allowed:
invalid_request
invalid_api_key
unauthorized
insufficient_credits
account_frozen
content_policy_violation
model_not_found
payload_too_large
request_timeout
rate_limit_exceeded
operation_rate_limit_exceeded
weekly_limit_exceeded
server_error
model_error
model_unavailable
message
string
required
min length 1
request_id
string
required
min length 1
status
integer
required
min 400 · max 599
413
Payload too large – the submitted prompt, image, or SVG input is too large.
code
string
required
Allowed:
invalid_request
invalid_api_key
unauthorized
insufficient_credits
account_frozen
content_policy_violation
model_not_found
payload_too_large
request_timeout
rate_limit_exceeded
operation_rate_limit_exceeded
weekly_limit_exceeded
server_error
model_error
model_unavailable
message
string
required
min length 1
request_id
string
required
min length 1
status
integer
required
min 400 · max 599
429
Rate limit exceeded – too many requests. The `code` field distinguishes the dimension: `rate_limit_exceeded` for the overall request rate, `operation_rate_limit_exceeded` for a single operation's throughput. Retry after the period indicated in the `Retry-After` header.
code
string
required
Allowed:
invalid_request
invalid_api_key
unauthorized
insufficient_credits
account_frozen
content_policy_violation
model_not_found
payload_too_large
request_timeout
rate_limit_exceeded
operation_rate_limit_exceeded
weekly_limit_exceeded
server_error
model_error
model_unavailable
message
string
required
min length 1
request_id
string
required
min length 1
status
integer
required
min 400 · max 599
500
The request could not be completed. Please retry.
code
string
required
Allowed:
invalid_request
invalid_api_key
unauthorized
insufficient_credits
account_frozen
content_policy_violation
model_not_found
payload_too_large
request_timeout
rate_limit_exceeded
operation_rate_limit_exceeded
weekly_limit_exceeded
server_error
model_error
model_unavailable
message
string
required
min length 1
request_id
string
required
min length 1
status
integer
required
min 400 · max 599
502
Bad gateway – model execution returned an invalid or failed response.
code
string
required
Allowed:
invalid_request
invalid_api_key
unauthorized
insufficient_credits
account_frozen
content_policy_violation
model_not_found
payload_too_large
request_timeout
rate_limit_exceeded
operation_rate_limit_exceeded
weekly_limit_exceeded
server_error
model_error
model_unavailable
message
string
required
min length 1
request_id
string
required
min length 1
status
integer
required
min 400 · max 599
503
Service unavailable – model execution is temporarily unavailable.
code
string
required
Allowed:
invalid_request
invalid_api_key
unauthorized
insufficient_credits
account_frozen
content_policy_violation
model_not_found
payload_too_large
request_timeout
rate_limit_exceeded
operation_rate_limit_exceeded
weekly_limit_exceeded
server_error
model_error
model_unavailable
message
string
required
min length 1
request_id
string
required
min length 1
status
integer
required
min 400 · max 599
504
Gateway timeout – model execution exceeded the server deadline.
code
string
required
Allowed:
invalid_request
invalid_api_key
unauthorized
insufficient_credits
account_frozen
content_policy_violation
model_not_found
payload_too_large
request_timeout
rate_limit_exceeded
operation_rate_limit_exceeded
weekly_limit_exceeded
server_error
model_error
model_unavailable
message
string
required
min length 1
request_id
string
required
min length 1
status
integer
required
min 400 · max 599
Request
cURL
JavaScript
Python
Copy
curl -X GET "https://api.quiver.ai/v1/models" \
  -H "Authorization: Bearer YOUR_TOKEN"
Response
200
400
401
402
403
408
413
429
500
502
503
504
{
  "data": [
    {
      "context_length": 0,
      "created": 0,
      "description": "string",
      "id": "string",
      "input_modalities": [
        "text"
      ],
      "max_output_length": 0,
      "name": "string",
      "object": "model",
      "output_modalities": [
        "text"
      ],
      "owned_by": "string",
      "pricing": {
        "svg_generate": "0.30",
        "svg_vectorize": "0.30"
      },
      "pricing_credits": {
        "svg_generate": 30,
        "svg_vectorize": 30
      },
      "supported_operations": [
        "svg_generate"
      ],
      "supported_sampling_parameters": [
        "temperature"
      ]
    }
  ],
  "object": "list"
}
QuiverAI public beta Docs

Vectorize Svg
Image to SVG
Converts an image input into an SVG output.

POST
/v1/svgs/vectorizations
Authorization
Authorization
Bearer token · header
required
Authentication via Bearer token API key
Header parameters
x-trace-id
string
Optional client-supplied trace identifier. The API echoes this value in `X-Trace-ID` and includes it in request logs for client-side correlation.
min length 1 · max length 256
Request body
required
application/json
attributes
SvgAttributes | null
Optional SVG root attributes requested by the caller.
max_output_tokens
integer
Upper bound for output token count.
min 1 · max 65536
model
string
required
Model identifier to use for generation or vectorization.
min length 1
presence_penalty
number | null
Penalty for tokens already present in prior output.
min -2 · max 2 · default: 0
stream
boolean
When true, emits a Server-Sent Events stream.
default: false
temperature
number
Sampling temperature.
min 0 · max 2 · default: 1
top_p
number
Nucleus sampling probability.
min 0 · max 1 · default: 1
auto_crop
boolean
Auto-crop image to the dominant subject before vectorization.
default: false
image
ImageInputReference
required
Image input reference. Accepts a network image URL or a base64-encoded image payload. Decoded images must be no larger than 12582912 bytes, 4096x4096 pixels, or 16777216 total pixels. Accepted direct media types: image/png, image/jpeg, image/webp, image/gif, image/svg+xml.
target_size
integer
Square resize target in pixels.
min 128 · max 4096
Responses
200
When `stream` is false, returns `application/json` with the full SVG response. When `stream` is true, returns `text/event-stream` with Server-Sent Events. Each SSE message contains an `event:` line (`generating`, `reasoning`, `draft`, or `content`) and a `data:` line with a JSON payload. `usage` token fields are deprecated and set to `0`; use `credits` for billing values. For streaming, `credits` is emitted on completed `content` events. The stream terminates with `data: [DONE]`.
created
integer
required
min 0
credits
integer
Credit cost for this request. Use this for billing instead of `usage` tokens.
min 0
data
SvgDocument[]
required
min items 1
id
string
required
min length 1
usage
SvgUsage
deprecated
Deprecated. Use `credits` for billing values.
400
Bad request – malformed body, missing required fields, or invalid parameter values.
code
string
required
Allowed:
invalid_request
invalid_api_key
unauthorized
insufficient_credits
account_frozen
content_policy_violation
model_not_found
payload_too_large
request_timeout
rate_limit_exceeded
operation_rate_limit_exceeded
weekly_limit_exceeded
server_error
model_error
model_unavailable
message
string
required
min length 1
request_id
string
required
min length 1
status
integer
required
min 400 · max 599
401
Unauthorized – missing, malformed, revoked, otherwise invalid API credentials, or an organization that could not be resolved for billing.
code
string
required
Allowed:
invalid_request
invalid_api_key
unauthorized
insufficient_credits
account_frozen
content_policy_violation
model_not_found
payload_too_large
request_timeout
rate_limit_exceeded
operation_rate_limit_exceeded
weekly_limit_exceeded
server_error
model_error
model_unavailable
message
string
required
min length 1
request_id
string
required
min length 1
status
integer
required
min 400 · max 599
402
Payment required – the organization has insufficient credits.
code
string
required
Allowed:
invalid_request
invalid_api_key
unauthorized
insufficient_credits
account_frozen
content_policy_violation
model_not_found
payload_too_large
request_timeout
rate_limit_exceeded
operation_rate_limit_exceeded
weekly_limit_exceeded
server_error
model_error
model_unavailable
message
string
required
min length 1
request_id
string
required
min length 1
status
integer
required
min 400 · max 599
403
Forbidden – the account is frozen, the request is not allowed, or content policy rejected the request.
code
string
required
Allowed:
invalid_request
invalid_api_key
unauthorized
insufficient_credits
account_frozen
content_policy_violation
model_not_found
payload_too_large
request_timeout
rate_limit_exceeded
operation_rate_limit_exceeded
weekly_limit_exceeded
server_error
model_error
model_unavailable
message
string
required
min length 1
request_id
string
required
min length 1
status
integer
required
min 400 · max 599
404
Not found – the requested model does not exist.
code
string
required
Allowed:
invalid_request
invalid_api_key
unauthorized
insufficient_credits
account_frozen
content_policy_violation
model_not_found
payload_too_large
request_timeout
rate_limit_exceeded
operation_rate_limit_exceeded
weekly_limit_exceeded
server_error
model_error
model_unavailable
message
string
required
min length 1
request_id
string
required
min length 1
status
integer
required
min 400 · max 599
408
Request timeout – the request exceeded an allowed client-facing deadline.
code
string
required
Allowed:
invalid_request
invalid_api_key
unauthorized
insufficient_credits
account_frozen
content_policy_violation
model_not_found
payload_too_large
request_timeout
rate_limit_exceeded
operation_rate_limit_exceeded
weekly_limit_exceeded
server_error
model_error
model_unavailable
message
string
required
min length 1
request_id
string
required
min length 1
status
integer
required
min 400 · max 599
413
Payload too large – the submitted prompt, image, or SVG input is too large.
code
string
required
Allowed:
invalid_request
invalid_api_key
unauthorized
insufficient_credits
account_frozen
content_policy_violation
model_not_found
payload_too_large
request_timeout
rate_limit_exceeded
operation_rate_limit_exceeded
weekly_limit_exceeded
server_error
model_error
model_unavailable
message
string
required
min length 1
request_id
string
required
min length 1
status
integer
required
min 400 · max 599
429
Rate limit exceeded – too many requests. The `code` field distinguishes the dimension: `rate_limit_exceeded` for the overall request rate, `operation_rate_limit_exceeded` for a single operation's throughput. Retry after the period indicated in the `Retry-After` header.
code
string
required
Allowed:
invalid_request
invalid_api_key
unauthorized
insufficient_credits
account_frozen
content_policy_violation
model_not_found
payload_too_large
request_timeout
rate_limit_exceeded
operation_rate_limit_exceeded
weekly_limit_exceeded
server_error
model_error
model_unavailable
message
string
required
min length 1
request_id
string
required
min length 1
status
integer
required
min 400 · max 599
500
The request could not be completed. Please retry.
code
string
required
Allowed:
invalid_request
invalid_api_key
unauthorized
insufficient_credits
account_frozen
content_policy_violation
model_not_found
payload_too_large
request_timeout
rate_limit_exceeded
operation_rate_limit_exceeded
weekly_limit_exceeded
server_error
model_error
model_unavailable
message
string
required
min length 1
request_id
string
required
min length 1
status
integer
required
min 400 · max 599
502
Bad gateway – model execution returned an invalid or failed response.
code
string
required
Allowed:
invalid_request
invalid_api_key
unauthorized
insufficient_credits
account_frozen
content_policy_violation
model_not_found
payload_too_large
request_timeout
rate_limit_exceeded
operation_rate_limit_exceeded
weekly_limit_exceeded
server_error
model_error
model_unavailable
message
string
required
min length 1
request_id
string
required
min length 1
status
integer
required
min 400 · max 599
503
Service unavailable – model execution is temporarily unavailable.
code
string
required
Allowed:
invalid_request
invalid_api_key
unauthorized
insufficient_credits
account_frozen
content_policy_violation
model_not_found
payload_too_large
request_timeout
rate_limit_exceeded
operation_rate_limit_exceeded
weekly_limit_exceeded
server_error
model_error
model_unavailable
message
string
required
min length 1
request_id
string
required
min length 1
status
integer
required
min 400 · max 599
504
Gateway timeout – model execution exceeded the server deadline.
code
string
required
Allowed:
invalid_request
invalid_api_key
unauthorized
insufficient_credits
account_frozen
content_policy_violation
model_not_found
payload_too_large
request_timeout
rate_limit_exceeded
operation_rate_limit_exceeded
weekly_limit_exceeded
server_error
model_error
model_unavailable
message
string
required
min length 1
request_id
string
required
min length 1
status
integer
required
min 400 · max 599
Request
cURL
JavaScript
Python
Copy
curl -X POST "https://api.quiver.ai/v1/svgs/vectorizations" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
  "attributes": {
    "viewBox": {
      "height": 512,
      "minX": 0,
      "minY": 0,
      "width": 512
    }
  },
  "max_output_tokens": 4096,
  "model": "arrow-1.1",
  "presence_penalty": 0.2,
  "stream": false,
  "temperature": 0.4,
  "top_p": 0.95,
  "auto_crop": true,
  "image": {
    "url": "https://example.com/uploads/reference1.png"
  },
  "target_size": 1024
}'
Response
200
400
401
402
403
404
408
413
429
500
502
503
504
{
  "created": 1704067200,
  "credits": 1,
  "data": [
    {
      "mime_type": "image/svg+xml",
      "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path d=\"M12 2l8 20H4z\"/></svg>"
    }
  ],
  "id": "resp_01J9AZ3XJ7D5S9ZV2Q5Z8E1A4N",
  "usage": {
    "input_tokens": 0,
    "output_tokens": 0,
    "total_tokens": 0
  }
}

Create Svgs
Text to SVG
Generates one or more SVGs from a prompt and optional references.

POST
/v1/svgs/generations
Authorization
Authorization
Bearer token · header
required
Authentication via Bearer token API key
Header parameters
x-trace-id
string
Optional client-supplied trace identifier. The API echoes this value in `X-Trace-ID` and includes it in request logs for client-side correlation.
min length 1 · max length 256
Request body
required
application/json
attributes
SvgAttributes | null
Optional SVG root attributes requested by the caller.
max_output_tokens
integer
Upper bound for output token count.
min 1 · max 65536
model
string
required
Model identifier to use for generation or vectorization.
min length 1
presence_penalty
number | null
Penalty for tokens already present in prior output.
min -2 · max 2 · default: 0
stream
boolean
When true, emits a Server-Sent Events stream.
default: false
temperature
number
Sampling temperature.
min 0 · max 2 · default: 1
top_p
number
Nucleus sampling probability.
min 0 · max 1 · default: 1
instructions
string
Additional style or formatting guidance.
min length 1
n
integer
Number of outputs to generate.
min 1 · max 16 · default: 1
prompt
string
required
Primary text prompt that describes the desired SVG.
min length 1
references
ImageInputReferenceInput[]
Optional reference images to guide style/composition. Accepts `{ url }`, `{ base64 }`, or URL string shorthand. Runtime limits are model-specific: 4 for Arrow 1.1/Arrow 1.x aliases, 16 for Arrow 1.1 Max.
max items 16
Responses
200
When `stream` is false, returns `application/json` with the full SVG response. When `stream` is true, returns `text/event-stream` with Server-Sent Events. Each SSE message contains an `event:` line (`generating`, `reasoning`, `draft`, or `content`) and a `data:` line with a JSON payload. For `n > 1`, events are interleaved across outputs, each output keeps a stable `data.id`, and `data.index` indicates the output position. `usage` token fields are deprecated and set to `0`; use `credits` for billing values. For streaming, `credits` is emitted on completed `content` events. The stream terminates with `data: [DONE]`.
created
integer
required
min 0
credits
integer
Credit cost for this request. Use this for billing instead of `usage` tokens.
min 0
data
SvgDocument[]
required
min items 1
id
string
required
min length 1
usage
SvgUsage
deprecated
Deprecated. Use `credits` for billing values.
400
Bad request – malformed body, missing required fields, or invalid parameter values.
code
string
required
Allowed:
invalid_request
invalid_api_key
unauthorized
insufficient_credits
account_frozen
content_policy_violation
model_not_found
payload_too_large
request_timeout
rate_limit_exceeded
operation_rate_limit_exceeded
weekly_limit_exceeded
server_error
model_error
model_unavailable
message
string
required
min length 1
request_id
string
required
min length 1
status
integer
required
min 400 · max 599
401
Unauthorized – missing, malformed, revoked, otherwise invalid API credentials, or an organization that could not be resolved for billing.
code
string
required
Allowed:
invalid_request
invalid_api_key
unauthorized
insufficient_credits
account_frozen
content_policy_violation
model_not_found
payload_too_large
request_timeout
rate_limit_exceeded
operation_rate_limit_exceeded
weekly_limit_exceeded
server_error
model_error
model_unavailable
message
string
required
min length 1
request_id
string
required
min length 1
status
integer
required
min 400 · max 599
402
Payment required – the organization has insufficient credits.
code
string
required
Allowed:
invalid_request
invalid_api_key
unauthorized
insufficient_credits
account_frozen
content_policy_violation
model_not_found
payload_too_large
request_timeout
rate_limit_exceeded
operation_rate_limit_exceeded
weekly_limit_exceeded
server_error
model_error
model_unavailable
message
string
required
min length 1
request_id
string
required
min length 1
status
integer
required
min 400 · max 599
403
Forbidden – the account is frozen, the request is not allowed, or content policy rejected the request.
code
string
required
Allowed:
invalid_request
invalid_api_key
unauthorized
insufficient_credits
account_frozen
content_policy_violation
model_not_found
payload_too_large
request_timeout
rate_limit_exceeded
operation_rate_limit_exceeded
weekly_limit_exceeded
server_error
model_error
model_unavailable
message
string
required
min length 1
request_id
string
required
min length 1
status
integer
required
min 400 · max 599
404
Not found – the requested model does not exist.
code
string
required
Allowed:
invalid_request
invalid_api_key
unauthorized
insufficient_credits
account_frozen
content_policy_violation
model_not_found
payload_too_large
request_timeout
rate_limit_exceeded
operation_rate_limit_exceeded
weekly_limit_exceeded
server_error
model_error
model_unavailable
message
string
required
min length 1
request_id
string
required
min length 1
status
integer
required
min 400 · max 599
408
Request timeout – the request exceeded an allowed client-facing deadline.
code
string
required
Allowed:
invalid_request
invalid_api_key
unauthorized
insufficient_credits
account_frozen
content_policy_violation
model_not_found
payload_too_large
request_timeout
rate_limit_exceeded
operation_rate_limit_exceeded
weekly_limit_exceeded
server_error
model_error
model_unavailable
message
string
required
min length 1
request_id
string
required
min length 1
status
integer
required
min 400 · max 599
413
Payload too large – the submitted prompt, image, or SVG input is too large.
code
string
required
Allowed:
invalid_request
invalid_api_key
unauthorized
insufficient_credits
account_frozen
content_policy_violation
model_not_found
payload_too_large
request_timeout
rate_limit_exceeded
operation_rate_limit_exceeded
weekly_limit_exceeded
server_error
model_error
model_unavailable
message
string
required
min length 1
request_id
string
required
min length 1
status
integer
required
min 400 · max 599
429
Rate limit exceeded – too many requests. The `code` field distinguishes the dimension: `rate_limit_exceeded` for the overall request rate, `operation_rate_limit_exceeded` for a single operation's throughput. Retry after the period indicated in the `Retry-After` header.
code
string
required
Allowed:
invalid_request
invalid_api_key
unauthorized
insufficient_credits
account_frozen
content_policy_violation
model_not_found
payload_too_large
request_timeout
rate_limit_exceeded
operation_rate_limit_exceeded
weekly_limit_exceeded
server_error
model_error
model_unavailable
message
string
required
min length 1
request_id
string
required
min length 1
status
integer
required
min 400 · max 599
500
The request could not be completed. Please retry.
code
string
required
Allowed:
invalid_request
invalid_api_key
unauthorized
insufficient_credits
account_frozen
content_policy_violation
model_not_found
payload_too_large
request_timeout
rate_limit_exceeded
operation_rate_limit_exceeded
weekly_limit_exceeded
server_error
model_error
model_unavailable
message
string
required
min length 1
request_id
string
required
min length 1
status
integer
required
min 400 · max 599
502
Bad gateway – model execution returned an invalid or failed response.
code
string
required
Allowed:
invalid_request
invalid_api_key
unauthorized
insufficient_credits
account_frozen
content_policy_violation
model_not_found
payload_too_large
request_timeout
rate_limit_exceeded
operation_rate_limit_exceeded
weekly_limit_exceeded
server_error
model_error
model_unavailable
message
string
required
min length 1
request_id
string
required
min length 1
status
integer
required
min 400 · max 599
503
Service unavailable – model execution is temporarily unavailable.
code
string
required
Allowed:
invalid_request
invalid_api_key
unauthorized
insufficient_credits
account_frozen
content_policy_violation
model_not_found
payload_too_large
request_timeout
rate_limit_exceeded
operation_rate_limit_exceeded
weekly_limit_exceeded
server_error
model_error
model_unavailable
message
string
required
min length 1
request_id
string
required
min length 1
status
integer
required
min 400 · max 599
504
Gateway timeout – model execution exceeded the server deadline.
code
string
required
Allowed:
invalid_request
invalid_api_key
unauthorized
insufficient_credits
account_frozen
content_policy_violation
model_not_found
payload_too_large
request_timeout
rate_limit_exceeded
operation_rate_limit_exceeded
weekly_limit_exceeded
server_error
model_error
model_unavailable
message
string
required
min length 1
request_id
string
required
min length 1
status
integer
required
min 400 · max 599
Request
cURL
JavaScript
Python
Copy
curl -X POST "https://api.quiver.ai/v1/svgs/generations" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
  "attributes": {
    "viewBox": {
      "height": 512,
      "minX": 0,
      "minY": 0,
      "width": 512
    }
  },
  "max_output_tokens": 4096,
  "model": "arrow-1.1",
  "presence_penalty": 0.2,
  "stream": false,
  "temperature": 0.4,
  "top_p": 0.95,
  "instructions": "Use a flat monochrome style with clean geometry.",
  "n": 1,
  "prompt": "Generate an icon of a unicorn",
  "references": [
    {
      "url": "https://example.com/uploads/reference1.png"
    }
  ]
}'
Response
200
400
401
402
403
404
408
413
429
500
502
503
504
{
  "created": 1704067200,
  "credits": 1,
  "data": [
    {
      "mime_type": "image/svg+xml",
      "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path d=\"M12 2l8 20H4z\"/></svg>"
    }
  ],
  "id": "resp_01J9AZ3XJ7D5S9ZV2Q5Z8E1A4N",
  "usage": {
    "input_tokens": 0,
    "output_tokens": 0,
    "total_tokens": 0
  }
}

