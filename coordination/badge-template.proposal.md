# Bounded badge template proposal

Scope: SPEC6.10 template gap. No arbitrary HTML, remote fonts, image URLs or executable expressions.

API domain `badge-template`: GET current requires onsite.read; POST `{expectedVersion,document}` requires new admin-only `documents.template.manage`; POST preview accepts document, same manage permission, renders a synthetic Traditional Chinese badge/QR payload that cannot check in any account. Version conflict returns409. Audit and durable outbox event committed with version insert.

Versioned tables reserved0033: state(singleton boolean PK,current_version integer), versions(version integer PK,document jsonb,created_by uuid references users,created_at timestamptz). Immutable version rows; state update serializes concurrent edits. Initial version1 safe default. RLS read uses trusted onsite admin context; writes use dedicated trusted badge_template_admin set only after central permission check. Worker does not need table grants because snapshots carry selected template.

Document fields: size=`credit_card|large` (86x54mm /100x140mm), layout=`centered|left`, showAffiliation boolean, showRegistrationNumber boolean, footer plain text<=120. QR mandatory, builtin local licensed CJK font, finite layout rules. Extremely long text that cannot fit at minimum type size fails visibly instead of clipping/overlapping QR. Preview is actual PDF from same renderer.

Job snapshot optional template `{version,document}`; absent keeps current exact legacy rendering so in-flight snapshots remain compatible. New jobs pin current version and full document. Retry keeps same snapshot and output; later template edits do not alter queued/issued badges. Existing token rotation/authority checks still apply.

UI `/admin/badge-template`: version indicator, enum selects, checkboxes, footer, save/preview buttons, explicit progress/error feedback. SDK owns requests, hook owns state, presentation receives props/callbacks. Link from document jobs screen for authorized admins; parent wires route and permission registry.

Verification: schema invalid enums/limits; real DB admin-only/version conflict/immutable old snapshot; renderer real PDF dimensions/content and QR decode; browser editor save and preview. No new dependency required.
