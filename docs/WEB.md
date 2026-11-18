# Web Application Architecture

Historical design for the retired browser client; this is not a development or deployment guide.

## Overview

The web application provides a browser-based UI for todufit, using server-side rendering with HTMX for interactivity. No SPA framework required.

The web server queries Automerge documents directly—no SQLite projection layer needed. This simplifies the architecture while providing sufficient performance for the expected data scale.

## Tech Stack

| Layer | Technology | Notes |
|-------|------------|-------|
| Server | Rust + axum | Same stack as CLI/sync |
| Templates | askama | Type-safe, compiled Jinja2-like templates |
| Interactivity | HTMX | Declarative AJAX |
| Small interactions | Alpine.js | Dropdowns, modals, toggles |
| Styling | Tailwind CSS or Simple CSS | Keep it minimal |
| Data | Automerge (direct queries) | No SQLite projection |
| Sessions | SQLite (sessions only) | Small, simple |
| Sync | automerge-rs | Syncs with todu-sync |

### Why askama?

- **Compile-time checking** - Template errors caught at build time, not runtime
- **Performance** - Templates compile to Rust code, very fast rendering
- **Familiar syntax** - Jinja2/Django-like (`{% for %}`, `{{ var }}`, `{% extends %}`)
- **Separate files** - HTML templates live in `templates/` directory
- **axum integration** - First-class support via `askama_axum`

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         todufit-web                                  │
│                                                                     │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │                       axum server                               │ │
│  │                                                                │ │
│  │  Routes:                                                       │ │
│  │  ├── GET  /                      → Dashboard                   │ │
│  │  ├── GET  /meals                 → Meal calendar               │ │
│  │  ├── GET  /meals/:date           → Day view                    │ │
│  │  ├── POST /meals/log             → Log a meal                  │ │
│  │  ├── GET  /dishes                → Dish list                   │ │
│  │  ├── GET  /dishes/:id            → Dish detail                 │ │
│  │  ├── GET  /dishes/new            → New dish form               │ │
│  │  ├── POST /dishes                → Create dish                 │ │
│  │  ├── GET  /auth/login            → Login page                  │ │
│  │  ├── POST /auth/login            → Initiate magic link         │ │
│  │  ├── GET  /auth/callback         → Magic link callback         │ │
│  │  ├── POST /auth/passkey/*        → Passkey endpoints           │ │
│  │  ├── POST /auth/logout           → Logout                      │ │
│  │  └── GET  /sse/updates           → Server-sent events          │ │
│  │                                                                │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌──────────────┐  ┌──────────────────────────────────────────────┐ │
│  │   askama     │  │         Per-User Automerge Storage           │ │
│  │  templates   │  │                                              │ │
│  └──────────────┘  │  /data/users/                                │ │
│                    │  ├── user_abc123/                            │ │
│  ┌──────────────┐  │  │   ├── dishes.automerge                   │ │
│  │   Sessions   │  │  │   ├── mealplans.automerge                │ │
│  │   (SQLite)   │  │  │   └── meallogs.automerge                 │ │
│  └──────────────┘  │  ├── user_def456/                            │ │
│                    │  │   └── ...                                 │ │
│                    │  └── (LRU cache of loaded docs)              │ │
│                    └──────────────────────────────────────────────┘ │
│                                      │                              │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │                    Static assets                                │ │
│  │  /static/htmx.min.js, alpine.min.js, styles.css               │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                      │                              │
└──────────────────────────────────────│──────────────────────────────┘
                                       │
                                       │ WebSocket sync
                                       ▼
                            ┌─────────────────────┐
                            │     todu-sync       │
                            │  (auth + sync)      │
                            └─────────────────────┘
```

## Data Flow

### Where Data Lives

| Component | What it stores |
|-----------|---------------|
| Browser | Nothing (just session cookie) |
| todufit-web server | Automerge docs per user, session table |
| todu-sync | Automerge docs (source of truth), user accounts |

The browser only receives rendered HTML. All data stays on the server.

### Request Flow: Page Load

```
Browser                          todufit-web Server
   │                                │
   │── GET /meals ─────────────────▶│
   │   Cookie: session=xxx          │
   │                                │
   │                    ┌───────────┴───────────┐
   │                    │ 1. Validate session   │
   │                    │    → get user_id      │
   │                    │                       │
   │                    │ 2. Load user's        │
   │                    │    Automerge docs     │
   │                    │    (from cache or     │
   │                    │     disk)             │
   │                    │                       │
   │                    │ 3. Query Automerge    │
   │                    │    directly           │
   │                    │                       │
   │                    │ 4. Render HTML        │
   │                    │    template           │
   │                    └───────────┬───────────┘
   │                                │
   │◀── Full HTML page ─────────────│
```

### Request Flow: Write Operation

```
Browser                          todufit-web Server                todu-sync
   │                                │                                  │
   │── POST /meals/log ────────────▶│                                  │
   │   Cookie: session=xxx          │                                  │
   │                                │                                  │
   │                    ┌───────────┴───────────┐                      │
   │                    │ 1. Validate session   │                      │
   │                    │                       │                      │
   │                    │ 2. Write to user's    │                      │
   │                    │    Automerge doc      │                      │
   │                    │                       │                      │
   │                    │ 3. Save to disk       │                      │
   │                    │                       │                      │
   │                    │ 4. Trigger async sync ├─────────────────────▶│
   │                    │                       │     WebSocket        │
   │                    │ 5. Render HTML        │                      │
   │                    └───────────┬───────────┘                      │
   │                                │                                  │
   │◀── HTML fragment ──────────────│                                  │
```

### Real-time Updates (SSE)

When another device syncs, push updates to connected browsers:

```
Browser                          todufit-web Server                todu-sync
   │                                │                                  │
   │── GET /sse/updates ───────────▶│                                  │
   │   (EventSource)                │                                  │
   │                                │                                  │
   │                                │◀──── sync update ────────────────│
   │                                │      (user's data changed)       │
   │                                │                                  │
   │◀── event: data-changed ────────│                                  │
   │    data: {"type": "meallog"}   │                                  │
   │                                │                                  │
   │  [HTMX refreshes component]    │                                  │
```

## Querying Automerge Directly

Instead of projecting to SQLite and querying SQL, we query Automerge documents directly.

### Why This Works

| Query Type | Automerge Performance | Notes |
|------------|----------------------|-------|
| Get by ID | O(1) | Map lookup |
| List all | O(n) | Iterate keys |
| Filter by field | O(n) | Scan all items |
| Date range | O(n) | Scan and filter |

For todufit's scale (hundreds of dishes, thousands of meal logs), O(n) scans complete in milliseconds.

### Example: Query Implementation

```rust
use automerge::{AutoCommit, ReadDoc, ROOT};

pub struct AutomergeDishRepo {
    storage: AutomergeStorage,
}

impl AutomergeDishRepo {
    /// Get all dishes from the Automerge document
    pub fn list(&self, user_id: &str) -> Result<Vec<Dish>, Error> {
        let doc = self.storage.load_user_doc(user_id, DocType::Dishes)?;
        
        let mut dishes = Vec::new();
        for key in doc.keys(ROOT) {
            if let Ok(Some((_, obj_id))) = doc.get(ROOT, &key) {
                if let Ok(dish) = self.extract_dish(&doc, &obj_id) {
                    dishes.push(dish);
                }
            }
        }
        
        Ok(dishes)
    }
    
    /// Get a single dish by ID
    pub fn get(&self, user_id: &str, dish_id: &Uuid) -> Result<Option<Dish>, Error> {
        let doc = self.storage.load_user_doc(user_id, DocType::Dishes)?;
        
        match doc.get(ROOT, &dish_id.to_string())? {
            Some((_, obj_id)) => Ok(Some(self.extract_dish(&doc, &obj_id)?)),
            None => Ok(None),
        }
    }
    
    /// Filter dishes by tag
    pub fn list_by_tag(&self, user_id: &str, tag: &str) -> Result<Vec<Dish>, Error> {
        Ok(self.list(user_id)?
            .into_iter()
            .filter(|d| d.tags.contains(&tag.to_string()))
            .collect())
    }
    
    /// Search dishes by name
    pub fn search(&self, user_id: &str, query: &str) -> Result<Vec<Dish>, Error> {
        let query_lower = query.to_lowercase();
        Ok(self.list(user_id)?
            .into_iter()
            .filter(|d| d.name.to_lowercase().contains(&query_lower))
            .collect())
    }
}
```

### Example: Meal Plans by Date Range

```rust
impl AutomergeMealPlanRepo {
    pub fn list_by_date_range(
        &self,
        user_id: &str,
        from: NaiveDate,
        to: NaiveDate,
    ) -> Result<Vec<MealPlan>, Error> {
        let doc = self.storage.load_user_doc(user_id, DocType::MealPlans)?;
        
        let mut plans = Vec::new();
        for key in doc.keys(ROOT) {
            if let Ok(Some((_, obj_id))) = doc.get(ROOT, &key) {
                if let Ok(plan) = self.extract_meal_plan(&doc, &obj_id) {
                    if plan.date >= from && plan.date <= to {
                        plans.push(plan);
                    }
                }
            }
        }
        
        // Sort by date, then meal type
        plans.sort_by(|a, b| {
            a.date.cmp(&b.date)
                .then(a.meal_type.cmp(&b.meal_type))
        });
        
        Ok(plans)
    }
}
```

## Per-User Document Storage

```rust
pub struct AutomergeStorage {
    base_path: PathBuf,
    cache: RwLock<LruCache<String, UserDocs>>,
}

struct UserDocs {
    dishes: AutoCommit,
    mealplans: AutoCommit,
    meallogs: AutoCommit,
    last_accessed: Instant,
}

impl AutomergeStorage {
    /// Load a user's document, from cache or disk
    pub fn load_user_doc(&self, user_id: &str, doc_type: DocType) -> Result<&AutoCommit, Error> {
        // Check cache first
        if let Some(docs) = self.cache.read().unwrap().get(user_id) {
            return Ok(docs.get(doc_type));
        }
        
        // Load from disk
        let user_dir = self.base_path.join("users").join(user_id);
        let docs = UserDocs {
            dishes: self.load_or_create(&user_dir, DocType::Dishes)?,
            mealplans: self.load_or_create(&user_dir, DocType::MealPlans)?,
            meallogs: self.load_or_create(&user_dir, DocType::MealLogs)?,
            last_accessed: Instant::now(),
        };
        
        // Add to cache
        self.cache.write().unwrap().put(user_id.to_string(), docs);
        
        Ok(self.cache.read().unwrap().get(user_id).unwrap().get(doc_type))
    }
    
    /// Save a user's document after modification
    pub fn save_user_doc(&self, user_id: &str, doc_type: DocType) -> Result<(), Error> {
        let user_dir = self.base_path.join("users").join(user_id);
        fs::create_dir_all(&user_dir)?;
        
        if let Some(docs) = self.cache.read().unwrap().get(user_id) {
            let path = user_dir.join(doc_type.filename());
            let data = docs.get(doc_type).save();
            fs::write(path, data)?;
        }
        
        Ok(())
    }
}
```

## Project Structure

```
todufit-web/
├── Cargo.toml
├── src/
│   ├── main.rs              # Server setup, routes
│   ├── routes/
│   │   ├── mod.rs
│   │   ├── auth.rs          # Login, logout, passkey
│   │   ├── meals.rs         # Meal logging, calendar
│   │   ├── dishes.rs        # Dish CRUD
│   │   └── sse.rs           # Server-sent events
│   ├── data/
│   │   ├── mod.rs
│   │   ├── storage.rs       # AutomergeStorage (per-user docs)
│   │   ├── dish_repo.rs     # Dish queries
│   │   ├── mealplan_repo.rs # MealPlan queries
│   │   └── meallog_repo.rs  # MealLog queries
│   ├── sync/
│   │   ├── mod.rs
│   │   └── client.rs        # WebSocket sync with todu-sync
│   ├── session.rs           # Session management (SQLite)
│   ├── middleware.rs        # Auth middleware
│   └── error.rs             # Error handling
├── templates/
│   ├── base.html            # Layout with nav, scripts
│   ├── auth/
│   │   └── login.html
│   ├── meals/
│   │   ├── calendar.html    # Week/month view
│   │   ├── day.html         # Single day
│   │   ├── log_form.html    # Log meal form (partial)
│   │   └── meal_card.html   # Single meal (partial)
│   └── dishes/
│       ├── list.html
│       ├── detail.html
│       └── form.html
├── static/
│   ├── htmx.min.js
│   ├── alpine.min.js
│   └── styles.css
└── migrations/
    └── 001_sessions.sql     # Sessions table only
```

## Repository Structure

`todufit-web` is a **separate repository** that depends on the shared `todufit-core` library from the main `todufit` repo.

### todufit repo (CLI + core)

```
todufit/
├── Cargo.toml               # Workspace
├── todufit-core/            # Shared library
│   ├── Cargo.toml
│   └── src/
│       ├── lib.rs
│       ├── models/          # Dish, MealPlan, MealLog
│       └── sync/            # Automerge read/write helpers
└── todufit-cli/             # CLI binary
    ├── Cargo.toml
    └── src/
        ├── main.rs
        ├── commands/
        └── db/              # SQLite projection (CLI-only)
```

### todufit-web repo (this app)

```
todufit-web/
├── Cargo.toml               # Depends on todufit-core via git
└── src/
    ├── main.rs
    ├── routes/
    ├── data/                # Automerge direct queries
    ├── session.rs
    └── templates/
```

### Cargo.toml Dependency

```toml
# todufit-web/Cargo.toml
[dependencies]
todufit-core = { git = "https://github.com/evcraddock/todufit" }
axum = "0.8"
askama = "0.13"
askama_axum = "0.4"
# ... other deps
```

**Note:** CLI keeps SQLite projection for complex offline queries. Web uses Automerge directly since it's always connected.

## Key Pages

### Dashboard (/)

- Today's meal plan at a glance
- Quick "Log Meal" button
- Recent activity
- Nutrition summary

### Meal Calendar (/meals)

- Week or month view
- Click date to see/edit that day
- Color-coded: planned vs logged
- HTMX: click meal to expand details inline

### Day View (/meals/:date)

- All meals for a specific date
- Log new meal button
- Nutrition totals for the day
- Edit/delete existing logs

### Dish Browser (/dishes)

- Searchable list of dishes
- Filter by tag
- Click to view details
- Quick-add to today's plan

### Dish Detail (/dishes/:id)

- Full recipe view
- Nutrition info
- Edit button (if owner)
- "Add to meal plan" action

## HTMX Patterns

### Form Submission

```html
<form hx-post="/meals/log" 
      hx-target="#meal-list" 
      hx-swap="beforeend">
  <select name="dish_id">...</select>
  <select name="meal_type">...</select>
  <button type="submit">Log Meal</button>
</form>

<div id="meal-list">
  <!-- New meal card will be appended here -->
</div>
```

### Inline Editing

```html
<div id="meal-123" hx-get="/meals/123/edit" hx-trigger="click" hx-swap="outerHTML">
  <h3>Breakfast: Overnight Oats</h3>
  <p>Click to edit</p>
</div>
```

### Search with Debounce

```html
<input type="search" 
       name="q" 
       hx-get="/dishes/search" 
       hx-trigger="keyup changed delay:300ms"
       hx-target="#dish-results">

<div id="dish-results">
  <!-- Search results appear here -->
</div>
```

### SSE Updates

```html
<div hx-ext="sse" sse-connect="/sse/updates">
  <div id="today-meals" sse-swap="meal-logged">
    <!-- Refreshed when meal-logged event received -->
  </div>
</div>
```

## Session Management

Sessions are the only thing stored in SQLite on the web server.

```rust
// Session stored in SQLite
pub struct Session {
    pub id: String,          // Random token (in cookie)
    pub user_id: String,
    pub email: String,
    pub api_key: String,     // For sync operations
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
}

// Middleware extracts session from cookie
pub async fn require_auth(
    State(state): State<AppState>,
    cookies: CookieJar,
    request: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    let session_id = cookies
        .get("session")
        .map(|c| c.value())
        .ok_or(StatusCode::UNAUTHORIZED)?;
    
    let session = state.sessions
        .get(&session_id)
        .await
        .ok_or(StatusCode::UNAUTHORIZED)?;
    
    if session.is_expired() {
        return Err(StatusCode::UNAUTHORIZED);
    }
    
    // Add session to request extensions
    let mut request = request;
    request.extensions_mut().insert(session);
    
    Ok(next.run(request).await)
}
```

**Sessions SQLite schema:**

```sql
CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    email TEXT NOT NULL,
    api_key TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
);

CREATE INDEX idx_sessions_expires ON sessions(expires_at);
```

## Sync Integration

The web server syncs with todu-sync on behalf of users:

```rust
pub struct SyncClient {
    server_url: String,
}

impl SyncClient {
    /// Sync a user's documents with todu-sync
    pub async fn sync_user(&self, user_id: &str, api_key: &str) -> Result<(), Error> {
        for doc_type in [DocType::Dishes, DocType::MealPlans, DocType::MealLogs] {
            self.sync_document(user_id, api_key, doc_type).await?;
        }
        Ok(())
    }
    
    /// Trigger async sync (fire and forget)
    pub fn sync_async(&self, user_id: String, api_key: String) {
        let client = self.clone();
        tokio::spawn(async move {
            if let Err(e) = client.sync_user(&user_id, &api_key).await {
                tracing::warn!("Background sync failed: {}", e);
            }
        });
    }
}

// Route handler
async fn log_meal(
    session: Session,
    State(state): State<AppState>,
    Form(input): Form<LogMealInput>,
) -> Result<Html<String>, AppError> {
    // 1. Write to Automerge
    state.meallog_repo.create(&session.user_id, &input).await?;
    
    // 2. Trigger background sync
    state.sync_client.sync_async(session.user_id.clone(), session.api_key.clone());
    
    // 3. Render response
    let html = render_meal_card(&input)?;
    Ok(Html(html))
}
```

## Initial Sync on Login

When a user logs in, sync their data before redirecting:

```rust
async fn auth_callback(
    State(state): State<AppState>,
    Query(params): Query<AuthCallbackParams>,
) -> Result<Response, AppError> {
    // 1. Verify token with todu-sync
    let auth_response = state.sync_server
        .verify_token(&params.token)
        .await?;
    
    // 2. Sync user's data from todu-sync
    state.sync_client
        .sync_user(&auth_response.user_id, &auth_response.api_key)
        .await?;
    
    // 3. Create session
    let session = Session {
        id: generate_session_id(),
        user_id: auth_response.user_id,
        email: auth_response.email,
        api_key: auth_response.api_key,
        created_at: Utc::now(),
        expires_at: Utc::now() + Duration::days(30),
    };
    state.sessions.create(&session).await?;
    
    // 4. Set cookie and redirect
    let cookie = Cookie::build(("session", session.id))
        .http_only(true)
        .secure(true)
        .same_site(SameSite::Strict)
        .path("/")
        .max_age(time::Duration::days(30));
    
    Ok((
        cookies.add(cookie),
        Redirect::to("/")
    ).into_response())
}
```

## Deployment

### Single Container

```dockerfile
FROM rust:1.75 as builder
WORKDIR /app
COPY . .
RUN cargo build --release --bin todufit-web

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/todufit-web /usr/local/bin/
COPY --from=builder /app/todufit-web/static /app/static
COPY --from=builder /app/todufit-web/templates /app/templates

ENV STATIC_DIR=/app/static
ENV TEMPLATE_DIR=/app/templates
ENV DATA_DIR=/data

VOLUME /data
EXPOSE 8080
CMD ["todufit-web"]
```

### Kubernetes (k3s)

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: todufit-web
spec:
  replicas: 1  # Single replica (user docs on local disk)
  selector:
    matchLabels:
      app: todufit-web
  template:
    metadata:
      labels:
        app: todufit-web
    spec:
      containers:
      - name: todufit-web
        image: your-registry/todufit-web:latest
        ports:
        - containerPort: 8080
        env:
        - name: DATA_DIR
          value: "/data"
        - name: SYNC_SERVER_URL
          value: "ws://todu-sync:8080"
        volumeMounts:
        - name: data
          mountPath: /data
      volumes:
      - name: data
        persistentVolumeClaim:
          claimName: todufit-web-data
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: todufit-web-data
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 1Gi
```

**Note:** Single replica because user Automerge docs are stored on local disk. For horizontal scaling, you'd need shared storage or move to the stateless architecture (Option 3 from earlier discussion).

## Mobile Responsiveness

Since this serves as fallback for mobile users (before native app):

- Use responsive CSS (Tailwind's responsive utilities or media queries)
- Touch-friendly tap targets (min 44x44px)
- Test on iOS Safari and Chrome Android
- Consider PWA manifest for "Add to Home Screen"

## Future: PWA Support

Add for improved mobile experience:

```json
// manifest.json
{
  "name": "Todufit",
  "short_name": "Todufit",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#4f46e5",
  "icons": [...]
}
```

```javascript
// service-worker.js
// Cache static assets for offline
// For full offline, would need IndexedDB + more complexity
```

## Performance Considerations

### When Direct Automerge Queries Work Well

- Hundreds of dishes ✓
- Thousands of meal plans/logs ✓
- Simple filters (by date, by tag, by ID) ✓
- In-memory after first load ✓

### When to Consider Adding SQLite Projection

- Full-text search across all fields
- Complex aggregations (monthly nutrition reports)
- Tens of thousands of records
- Query patterns not known at compile time

For now, start simple. Add SQLite projection later only if needed.
