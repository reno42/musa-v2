function jsonRpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

export function createInitializeResponse(id, headers, result) {
  return {
    statusCode: 200,
    headers,
    body: JSON.stringify(jsonRpcResult(id, result)),
  };
}

export function createInitializedNotificationResponse(id, headers) {
  if (id === undefined) {
    const responseHeaders = Object.fromEntries(
      Object.entries(headers).filter(([name]) => name.toLowerCase() !== "content-type"),
    );
    return { statusCode: 202, headers: responseHeaders, body: "" };
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify(jsonRpcResult(id, {})),
  };
}

export function createToolsListResponse(id, headers, tools) {
  return {
    statusCode: 200,
    headers,
    body: JSON.stringify(jsonRpcResult(id, { tools })),
  };
}
