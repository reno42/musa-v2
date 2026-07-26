// =============================================
// Futuraria CRM Ã¢ÂÂ TypeScript Types
// Mirrors Supabase schema (v2 Ã¢ÂÂ includes Companies + Tasks)
// =============================================

export type LeadSource = 'website' | 'referral' | 'linkedin' | 'cold_outreach' | 'event' | 'social_media' | 'organic' | 'partner' | 'other'

export type LeadStage = 'new' | 'researching' | 'contacted' | 'qualified' | 'demo_scheduled' | 'proposal_sent' | 'negotiation' | 'won' | 'lost' | 'nurturing' | 'discarded'

export type LeadPriority = 'low' | 'medium' | 'high' | 'urgent'

export type DealStage = 'discovery' | 'proposal' | 'negotiation' | 'closed_won' | 'closed_lost'

export type ActivityType = 'note' | 'email' | 'call' | 'meeting' | 'whatsapp' | 'demo' | 'proposal' | 'follow_up' | 'status_change' | 'enrichment'

export type ContactRole = 'decision_maker' | 'influencer' | 'buyer' | 'end_user' | 'champion' | 'gatekeeper' | 'other'

export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'cancelled'

export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent'

// =============================================
// Core Models
// =============================================

export interface Company {
  id: string
  name: string
  domain: string | null
  industry: string | null
  size: string | null
  phone: string | null
  email: string | null
  address: string | null
  city: string | null
  country: string | null
  linkedin_url: string | null
  twitter_url: string | null
  website: string | null
  revenue_range: string | null
  description: string | null
  logo_url: string | null
  tags: string[]
  notes: string | null
  assigned_to: string | null
  created_at: string
  updated_at: string
}

export interface LeadEnrichment {
  // Domain & hosting
  website?: string
  domain?: string
  domain_registered?: string        // ISO date
  domain_expires?: string           // ISO date
  domain_age_years?: number
  hosting_provider?: string
  cdn?: string                      // e.g. "Cloudflare"

  // Tech stack
  tech_stack?: string[]
  page_builder?: string             // "WordPress + Elementor Pro"
  cms?: string                      // "WordPress 6.7"
  server?: string                   // "LiteSpeed"
  uses_elementor?: boolean
  has_ecommerce?: boolean
  has_ssl?: boolean
  ssl_issues?: string[]             // ["HSTS missing", "CSP missing"]
  security_headers?: Record<string, boolean>

  // Content
  has_blog?: boolean
  blog_last_post_date?: string
  footer_copyright_year?: number
  content_freshness?: 'current' | 'stale' | 'outdated' // based on footer vs current year
  text_to_html_ratio?: number

  // SEO & GEO
  seo_score?: number                // 0-100
  seo_issues?: string[]
  geo_ready?: boolean               // Generative Engine Optimization
  blocked_bots?: string[]           // ["GPTBot", "Amazonbot", "Claudebot"]
  schema_org?: string[]             // ["Person", "Organization", "Service"]
  h1_count?: number
  meta_description?: boolean
  render_blocking_scripts?: number

  // Social media (legacy Ã¢ÂÂ backward compatible)
  social_media?: Record<string, string>
  social_media_stats?: {
    instagram?: { followers?: number; posts?: number; strategy?: string }
    facebook?: { followers?: number; strategy?: string }
    tiktok?: { followers?: number }
    linkedin?: { connections?: number; active?: boolean; posts_frequency?: string }
    youtube?: { subscribers?: number; video_count?: number; status?: string }
  }
  social_media_active?: boolean

  // Structured social media Ã¢ÂÂ Personal
  personal_social_media?: Array<{
    platform: 'instagram' | 'tiktok' | 'linkedin' | 'whatsapp' | 'facebook' | 'medium' | 'pinterest' | 'twitter' | 'other'
    handle?: string
    url?: string
    followers?: number
    posts?: number
    is_active?: boolean
  }>

  // Structured social media Ã¢ÂÂ Business
  business_social_media?: Array<{
    platform: 'instagram' | 'tiktok' | 'linkedin' | 'facebook' | 'medium' | 'pinterest' | 'twitter' | 'other'
    handle?: string
    url?: string
    followers?: number
    posts?: number
    is_active?: boolean
  }>

  // Press mentions (structured)
  press_mentions?: Array<{
    title: string
    url?: string
    source?: string
    date?: string
    type?: 'formal' | 'digital'
  }>

  // Platforms & channels
  has_youtube?: boolean
  has_hotmart?: boolean
  has_linktree?: boolean
  has_substack?: boolean
  has_calendly?: boolean
  press_mentions_count?: number     // legacy numeric count (renamed from press_mentions to avoid conflict)
  press_type?: ('formal' | 'digital')[]
  google_my_business?: boolean
  channels_found?: string[]         // ["linktree", "substack", "beehive"]

  // Automation & messaging
  automation_tools?: string[]       // ["zapier", "n8n", "make"]
  chatbots_detected?: boolean
  whatsapp_type?: 'personal' | 'business' | 'business_with_bot' | 'none'
  has_vsl?: boolean

  // Operations maturity
  has_crm?: boolean
  has_landing_pages?: boolean
  has_lead_magnets?: boolean
  has_email_automation?: boolean

  // Business intelligence
  homonimos_found?: boolean
  homonimos_details?: string[]
  operates_multicountry?: boolean
  countries?: string[]
  digital_maturity_level?: 'beginner' | 'intermediate' | 'advanced'
  b2b_profile?: 'decision_maker' | 'influencer' | 'buyer' | 'end_user' | 'champion' | 'gatekeeper' | 'unknown'

  // Meta
  enriched_at?: string              // ISO timestamp
  enrichment_source?: 'manual' | 'n8n' | 'agent'
  raw_search_results?: Record<string, unknown>
}

export interface DigitalPresence {
  website_type?: 'corporate' | 'vsl' | 'both' | 'none'
  last_website_update_year?: number
  content_strategy?: 'blog' | 'social' | 'none' | 'testing'
  linkedin_active?: boolean
  instagram_strategy?: 'educational' | 'promotional' | 'mixed' | 'none'
  perceived_digital_level?: 'beginner' | 'intermediate' | 'advanced'
  needs_explanation?: string[]      // ["branding", "web", "analytics", "automation"]

  // Extended for audit report
  ecosystem?: string[]              // full list of digital channels
  operational_islands?: string[]    // disconnected systems
  missing_automations?: string[]    // ["carrito abandonado", "nurturing", "post-venta"]
  brand_focus?: 'b2b' | 'b2c' | 'both' | 'unclear'
  content_quality?: 'high' | 'medium' | 'low' | 'testing'
}

export interface Lead {
  id: string
  full_name: string
  email: string | null
  phone: string | null
  whatsapp: string | null
  company_name: string | null
  company_role: string | null
  industry: string | null
  company_size: string | null
  company_id: string | null
  role: ContactRole
  source: LeadSource
  source_detail: string | null
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  stage: LeadStage
  priority: LeadPriority
  assigned_to: string | null
  score: number
  score_breakdown: Record<string, number>
  enrichment: LeadEnrichment
  digital_presence: DigitalPresence
  budget_range: string | null
  timeline: string | null
  pain_points: string[]
  interests: string[]
  tags: string[]
  notes: string | null
  created_at: string
  updated_at: string
  last_contacted_at: string | null
  next_follow_up_at: string | null
  // Enrichment - Website Analysis (editable columns)
  website_url: string | null
  website_tech: string | null
  domain_age_year: number | null
  footer_year: number | null
  last_blog_date: string | null
  has_linkedin_active: boolean
  instagram_type: string | null
  has_hotmart: boolean
  press_coverage: string | null
  youtube_status: string | null
  google_my_business: boolean
  digital_channels: string[]
  lead_score: number
  lead_stage_detail: string | null
  diagnostic_sent: boolean
  diagnostic_url: string | null
}

/** @deprecated Use Lead with role field. */
export interface Contact {
  id: string
  lead_id: string | null
  full_name: string
  email: string | null
  phone: string | null
  whatsapp: string | null
  role: ContactRole
  company_name: string | null
  title: string | null
  linkedin_url: string | null
  is_primary: boolean
  tags: string[]
  notes: string | null
  created_at: string
  updated_at: string
}

export interface Deal {
  id: string
  lead_id: string
  title: string
  description: string | null
  stage: DealStage
  value: number | null
  currency: string
  probability: number
  services: string[]
  expected_close_date: string | null
  actual_close_date: string | null
  assigned_to: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface Activity {
  id: string
  lead_id: string | null
  deal_id: string | null
  type: ActivityType
  title: string
  description: string | null
  metadata: Record<string, unknown>
  performed_by: string | null
  created_at: string
}

export interface Task {
  id: string
  title: string
  description: string | null
  status: TaskStatus
  priority: TaskPriority
  lead_id: string | null
  deal_id: string | null
  company_id: string | null
  due_date: string | null
  completed_at: string | null
  assigned_to: string | null
  tags: string[]
  created_at: string
  updated_at: string
}

export interface EmailTemplate {
  id: string
  name: string
  subject: string
  body: string
  category: string | null
  is_active: boolean
  usage_count: number
  created_at: string
  updated_at: string
}

// =============================================
// API Types
// =============================================

export interface CreateLeadInput {
  full_name: string
  email?: string
  phone?: string
  whatsapp?: string
  company_name?: string
  company_id?: string
  company_role?: string
  industry?: string
  role?: ContactRole
  source?: LeadSource
  source_detail?: string
  stage?: LeadStage
  priority?: LeadPriority
  notes?: string
  tags?: string[]
}

export interface UpdateLeadInput extends Partial<CreateLeadInput> {
  score?: number
  enrichment?: LeadEnrichment
  digital_presence?: DigitalPresence
  budget_range?: string
  timeline?: string
  pain_points?: string[]
  interests?: string[]
  next_follow_up_at?: string
}

export interface CreateCompanyInput {
  name: string
  domain?: string
  industry?: string
  size?: string
  phone?: string
  email?: string
  address?: string
  city?: string
  country?: string
  linkedin_url?: string
  twitter_url?: string
  website?: string
  revenue_range?: string
  description?: string
  tags?: string[]
  notes?: string
}

export interface CreateTaskInput {
  title: string
  description?: string
  status?: TaskStatus
  priority?: TaskPriority
  lead_id?: string
  deal_id?: string
  company_id?: string
  due_date?: string
  tags?: string[]
}

export interface WebhookPayload {
  event: 'lead.created' | 'lead.updated' | 'lead.qualified' | 'deal.created' | 'deal.won'
  data: Record<string, unknown>
  timestamp?: string
  signature?: string
}

export interface LeadStats {
  stage: LeadStage
  count: number
  avg_score: number
  urgent_count: number
}

export interface PipelineSummary {
  stage: DealStage
  deal_count: number
  total_value: number
  avg_probability: number
  weighted_value: number
}

// =============================================
// View Types
// =============================================

export interface CompanyStats {
  id: string
  name: string
  industry: string | null
  lead_count: number
  deal_count: number
  total_deal_value: number
  last_lead_at: string | null
}

export interface TaskSummary {
  status: TaskStatus
  count: number
  overdue_count: number
}
