export type Locale = 'es' | 'en'

export const translations = {
  // Sidebar
  'sidebar.favorites': { es: 'Favoritos', en: 'Favorites' },
  'sidebar.workspace': { es: 'Espacio de trabajo', en: 'Workspace' },
  'sidebar.settings': { es: 'Configuración', en: 'Settings' },
  'sidebar.newLead': { es: 'Nuevo Lead', en: 'New Lead' },

  // Nav items
  'nav.dashboard': { es: 'Dashboard', en: 'Dashboard' },
  'nav.companies': { es: 'Empresas', en: 'Companies' },
  'nav.people': { es: 'Personas', en: 'People' },
  'nav.opportunities': { es: 'Oportunidades', en: 'Opportunities' },
  'nav.leads': { es: 'Leads', en: 'Leads' },
  'nav.tasks': { es: 'Tareas', en: 'Tasks' },
  'nav.notes': { es: 'Notas', en: 'Notes' },
  'nav.dashboards': { es: 'Dashboards', en: 'Dashboards' },
  'nav.workflows': { es: 'Workflows', en: 'Workflows' },
  'nav.pipeline': { es: 'Pipeline', en: 'Pipeline' },

  // Common
  'common.search': { es: 'Buscar...', en: 'Search...' },
  'common.save': { es: 'Guardar', en: 'Save' },
  'common.cancel': { es: 'Cancelar', en: 'Cancel' },
  'common.delete': { es: 'Eliminar', en: 'Delete' },
  'common.create': { es: 'Crear', en: 'Create' },
  'common.edit': { es: 'Editar', en: 'Edit' },
  'common.close': { es: 'Cerrar', en: 'Close' },
  'common.change': { es: 'Cambiar', en: 'Change' },
  'common.add': { es: 'Agregar', en: 'Add' },
  'common.loading': { es: 'Cargando...', en: 'Loading...' },
  'common.noData': { es: 'Sin datos', en: 'No data' },
  'common.clickToEdit': { es: 'Click para editar', en: 'Click to edit' },
  'common.enterToSave': { es: 'Enter para guardar · Esc para cancelar', en: 'Enter to save · Esc to cancel' },

  // Leads
  'leads.title': { es: 'Leads', en: 'Leads' },
  'leads.new': { es: 'Nuevo Lead', en: 'New Lead' },
  'leads.noLeads': { es: 'Sin leads', en: 'No leads' },
  'leads.createFirst': { es: 'Crea tu primer lead para empezar', en: 'Create your first lead to get started' },
  'leads.searchPlaceholder': { es: 'Buscar leads...', en: 'Search leads...' },
  'leads.name': { es: 'Nombre', en: 'Name' },
  'leads.stage': { es: 'Etapa', en: 'Stage' },
  'leads.priority': { es: 'Prioridad', en: 'Priority' },
  'leads.score': { es: 'Puntaje', en: 'Score' },
  'leads.source': { es: 'Fuente', en: 'Source' },
  'leads.created': { es: 'Creado', en: 'Created' },
  'leads.fullName': { es: 'Nombre completo', en: 'Full Name' },
  'leads.email': { es: 'Correo', en: 'Email' },
  'leads.phone': { es: 'Teléfono', en: 'Phone' },
  'leads.whatsapp': { es: 'WhatsApp', en: 'WhatsApp' },
  'leads.company': { es: 'Empresa', en: 'Company' },
  'leads.role': { es: 'Cargo', en: 'Role' },
  'leads.industry': { es: 'Industria', en: 'Industry' },
  'leads.budget': { es: 'Presupuesto', en: 'Budget' },
  'leads.timeline': { es: 'Timeline', en: 'Timeline' },
  'leads.notes': { es: 'Notas', en: 'Notes' },
  'leads.tags': { es: 'Etiquetas', en: 'Tags' },
  'leads.addNote': { es: 'Agregar Nota', en: 'Add Note' },
  'leads.writeNote': { es: 'Escribe una nota...', en: 'Write a note...' },
  'leads.activity': { es: 'Actividad', en: 'Activity' },
  'leads.noActivity': { es: 'Sin actividad', en: 'No activity' },
  'leads.digitalPresence': { es: 'Presencia Digital', en: 'Digital Presence' },
  'leads.quickActions': { es: 'Acciones Rápidas', en: 'Quick Actions' },
  'leads.sendEmail': { es: 'Enviar Correo', en: 'Send Email' },
  'leads.generateReport': { es: 'Generar Reporte', en: 'Generate Report' },
  'leads.deleteConfirm': { es: '¿Eliminar este lead? No se puede deshacer.', en: 'Delete this lead? This cannot be undone.' },
  'leads.notFound': { es: 'Lead no encontrado', en: 'Lead not found' },
  'leads.tryDifferent': { es: 'Intenta otra búsqueda', en: 'Try a different search' },

  // Stages
  'stage.new': { es: 'Nuevo', en: 'New' },
  'stage.researching': { es: 'Investigando', en: 'Researching' },
  'stage.contacted': { es: 'Contactado', en: 'Contacted' },
  'stage.qualified': { es: 'Calificado', en: 'Qualified' },
  'stage.demo_scheduled': { es: 'Demo', en: 'Demo' },
  'stage.proposal_sent': { es: 'Propuesta', en: 'Proposal' },
  'stage.negotiation': { es: 'Negociación', en: 'Negotiation' },
  'stage.won': { es: 'Ganado', en: 'Won' },
  'stage.lost': { es: 'Perdido', en: 'Lost' },
  'stage.nurturing': { es: 'Nurturing', en: 'Nurturing' },
  'stage.discarded': { es: 'Descartado', en: 'Discarded' },
  'stage.all': { es: 'Todos', en: 'All' },

  // Priority
  'priority.low': { es: 'Baja', en: 'Low' },
  'priority.medium': { es: 'Media', en: 'Medium' },
  'priority.high': { es: 'Alta', en: 'High' },
  'priority.urgent': { es: 'Urgente', en: 'Urgent' },

  // Source
  'source.website': { es: 'Sitio Web', en: 'Website' },
  'source.linkedin': { es: 'LinkedIn', en: 'LinkedIn' },
  'source.referral': { es: 'Referido', en: 'Referral' },
  'source.cold_outreach': { es: 'Outreach', en: 'Outreach' },
  'source.event': { es: 'Evento', en: 'Event' },
  'source.social_media': { es: 'Social', en: 'Social' },
  'source.organic': { es: 'Orgánico', en: 'Organic' },
  'source.partner': { es: 'Socio', en: 'Partner' },
  'source.other': { es: 'Otro', en: 'Other' },

  // Companies
  'companies.title': { es: 'Empresas', en: 'Companies' },
  'companies.new': { es: 'Nueva Empresa', en: 'New Company' },
  'companies.searchPlaceholder': { es: 'Buscar empresas...', en: 'Search companies...' },
  'companies.noCompanies': { es: 'Sin empresas', en: 'No companies' },
  'companies.name': { es: 'Nombre', en: 'Name' },
  'companies.industry': { es: 'Industria', en: 'Industry' },
  'companies.size': { es: 'Tamaño', en: 'Size' },
  'companies.location': { es: 'Ubicación', en: 'Location' },
  'companies.details': { es: 'Detalles', en: 'Details' },
  'companies.description': { es: 'Descripción', en: 'Description' },
  'companies.deleteConfirm': { es: '¿Eliminar esta empresa? Los leads asociados NO se eliminarán.', en: 'Delete this company? Associated leads will NOT be deleted.' },
  'companies.notFound': { es: 'Empresa no encontrada', en: 'Company not found' },
  'companies.noLinkedLeads': { es: 'Sin leads vinculados', en: 'No linked leads' },
  'companies.noDeals': { es: 'Sin deals', en: 'No deals' },
  'companies.noTasks': { es: 'Sin tareas', en: 'No tasks' },
  'companies.leads': { es: 'Leads', en: 'Leads' },
  'companies.deals': { es: 'Deals', en: 'Deals' },
  'companies.tasks': { es: 'Tareas', en: 'Tasks' },
  'companies.totalValue': { es: 'Valor Total', en: 'Total Value' },
  'companies.domain': { es: 'Dominio', en: 'Domain' },
  'companies.revenue': { es: 'Ingresos', en: 'Revenue' },
  'companies.address': { es: 'Dirección', en: 'Address' },
  'companies.city': { es: 'Ciudad', en: 'City' },
  'companies.country': { es: 'País', en: 'Country' },

  // Deals
  'deals.title': { es: 'Pipeline', en: 'Pipeline' },
  'deals.new': { es: 'Nuevo Deal', en: 'New Deal' },
  'deals.totalPipeline': { es: 'Pipeline Total', en: 'Total Pipeline' },
  'deals.weighted': { es: 'Ponderado', en: 'Weighted' },
  'deals.noDeals': { es: 'Sin deals', en: 'No deals' },
  'deals.createFirst': { es: 'Crea tu primer deal para rastrear tu pipeline', en: 'Create your first deal to start tracking your pipeline' },
  'deals.dealTitle': { es: 'Título del deal', en: 'Deal title' },
  'deals.linkToLead': { es: 'Vincular a lead (opcional)', en: 'Link to lead (optional)' },
  'deals.description': { es: 'Descripción', en: 'Description' },
  'deals.value': { es: 'Valor', en: 'Value' },
  'deals.probability': { es: 'Probabilidad', en: 'Probability' },
  'deals.expectedClose': { es: 'Cierre esperado', en: 'Expected close' },
  'deals.moveToStage': { es: 'Mover a etapa', en: 'Move to stage' },
  'deals.deleteConfirm': { es: '¿Eliminar este deal?', en: 'Delete this deal?' },
  'deals.lostDeals': { es: 'Deals perdidos', en: 'Lost deals' },
  'deals.noDealsInStage': { es: 'Sin deals', en: 'No deals' },

  // Deal stages
  'dealStage.discovery': { es: 'Descubrimiento', en: 'Discovery' },
  'dealStage.proposal': { es: 'Propuesta', en: 'Proposal' },
  'dealStage.negotiation': { es: 'Negociación', en: 'Negotiation' },
  'dealStage.closed_won': { es: 'Ganado', en: 'Won' },
  'dealStage.closed_lost': { es: 'Perdido', en: 'Lost' },

  // Tasks
  'tasks.title': { es: 'Tareas', en: 'Tasks' },
  'tasks.new': { es: 'Nueva Tarea', en: 'New Task' },
  'tasks.noTasks': { es: 'Sin tareas', en: 'No tasks' },
  'tasks.whatToDo': { es: '¿Qué hay que hacer?', en: 'What needs to be done?' },
  'tasks.description': { es: 'Descripción (opcional)', en: 'Description (optional)' },
  'tasks.overdue': { es: 'tarea(s) vencida(s)', en: 'overdue task(s)' },
  'tasks.createTask': { es: '+ Crear tarea', en: '+ Create task' },
  'tasks.all': { es: 'Todas', en: 'All' },
  'tasks.todo': { es: 'Por hacer', en: 'To Do' },
  'tasks.inProgress': { es: 'En progreso', en: 'In Progress' },
  'tasks.done': { es: 'Hecha', en: 'Done' },
  'tasks.cancelled': { es: 'Cancelada', en: 'Cancelled' },
  'tasks.dueDate': { es: 'Fecha límite', en: 'Due date' },
  'tasks.deleteConfirm': { es: '¿Eliminar esta tarea?', en: 'Delete this task?' },

  // Settings
  'settings.language': { es: 'Idioma', en: 'Language' },
  'settings.theme': { es: 'Tema', en: 'Theme' },
  'settings.light': { es: 'Claro', en: 'Light' },
  'settings.dark': { es: 'Oscuro', en: 'Dark' },
  'settings.spanish': { es: 'Español', en: 'Spanish' },
  'settings.english': { es: 'Inglés', en: 'English' },

  // Form labels
  'form.fullNameRequired': { es: 'Nombre completo *', en: 'Full Name *' },
  'form.contact': { es: 'Contacto', en: 'Contact' },
  'form.company': { es: 'Empresa', en: 'Company' },
  'form.companyName': { es: 'Nombre de la empresa', en: 'Company name' },
  'form.sourceDetail': { es: 'Detalle de fuente (ej. comentario en LinkedIn)', en: 'Source detail (e.g. LinkedIn post comment)' },
  'form.additionalNotes': { es: 'Notas adicionales...', en: 'Additional notes...' },
  'form.createLead': { es: 'Crear Lead', en: 'Create Lead' },
  'form.saving': { es: 'Guardando...', en: 'Saving...' },
  'form.errorCreating': { es: 'Error al crear lead', en: 'Error creating lead' },
  'form.errorCreatingCompany': { es: 'Error al crear empresa', en: 'Error creating company' },

  // Company form
  'form.basicInfo': { es: 'Información Básica', en: 'Basic Information' },
  'form.domain': { es: 'Dominio / Sitio Web', en: 'Domain / Website' },
  'form.companySize': { es: 'Tamaño de la empresa', en: 'Company Size' },
  'form.selectSize': { es: 'Seleccionar tamaño...', en: 'Select size...' },
  'form.revenueRange': { es: 'Rango de ingresos', en: 'Revenue Range' },
  'form.selectRange': { es: 'Seleccionar rango...', en: 'Select range...' },
  'form.address': { es: 'Dirección', en: 'Street Address' },
  'form.social': { es: 'Redes Sociales', en: 'Social' },
  'form.whatDoesCompanyDo': { es: '¿Qué hace esta empresa?', en: 'What does this company do?' },
  'form.internalNotes': { es: 'Notas internas...', en: 'Internal notes...' },
  'form.createCompany': { es: 'Crear Empresa', en: 'Create Company' },
  'form.creating': { es: 'Creando...', en: 'Creating...' },

  // People
  'people.title': { es: 'Personas', en: 'People' },
  'people.new': { es: 'Nuevo Contacto', en: 'New Contact' },
  'people.noContacts': { es: 'Sin contactos', en: 'No contacts' },
  'people.searchPlaceholder': { es: 'Buscar personas...', en: 'Search people...' },

  // Command Menu
  'command.search': { es: 'Buscar leads, empresas, contactos, deals...', en: 'Search leads, companies, contacts, deals...' },
  'command.quickActions': { es: 'Acciones Rápidas', en: 'Quick Actions' },
  'command.noResults': { es: 'Sin resultados', en: 'No results' },

  // Settings page
  'settings.title': { es: 'Configuración', en: 'Settings' },
  'settings.appearance': { es: 'Apariencia', en: 'Appearance' },
  'settings.languageRegion': { es: 'Idioma y Región', en: 'Language & Region' },
  'settings.currentLanguage': { es: 'Idioma actual', en: 'Current language' },
  'settings.currentTheme': { es: 'Tema actual', en: 'Current theme' },

  // Webhook Logs
  'nav.webhookLogs': { es: 'Logs Webhook', en: 'Webhook Logs' },
  'nav.webhooks': { es: 'Webhooks', en: 'Webhooks' },

  // Notes
  'notes.title': { es: 'Notas', en: 'Notes' },
  'notes.new': { es: 'Nueva Nota', en: 'New Note' },
  'notes.searchPlaceholder': { es: 'Buscar notas...', en: 'Search notes...' },
  'notes.noNotes': { es: 'Sin notas', en: 'No notes' },
  'notes.createFirst': { es: 'Crea tu primera nota', en: 'Create your first note' },

  // Workflows
  'workflows.title': { es: 'Workflows', en: 'Workflows' },
  'workflows.noRuns': { es: 'Sin ejecuciones', en: 'No workflow runs' },
  'workflows.refresh': { es: 'Actualizar', en: 'Refresh' },

  // Export
  'common.export': { es: 'Exportar', en: 'Export' },
  'common.exportCSV': { es: 'Exportar CSV', en: 'Export CSV' },

  // Email
  'email.send': { es: 'Enviar Email', en: 'Send Email' },
  'email.to': { es: 'Para', en: 'To' },
  'email.subject': { es: 'Asunto', en: 'Subject' },
  'email.body': { es: 'Mensaje', en: 'Message' },
  'email.sending': { es: 'Enviando...', en: 'Sending...' },
  'email.sent': { es: 'Email enviado', en: 'Email sent' },
  'email.error': { es: 'Error al enviar', en: 'Error sending email' },

  // Pagination
  'pagination.showing': { es: 'Mostrando', en: 'Showing' },
  'pagination.of': { es: 'de', en: 'of' },
} as const

export type TranslationKey = keyof typeof translations

export function t(key: TranslationKey, locale: Locale): string {
  return translations[key][locale] ?? translations[key]['en'] ?? key
}

// =============================================
// Added keys (append to translations object)
// =============================================
// These are added to fix hardcoded strings:
