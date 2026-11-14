# Database Manager handbook

Every Atai business gets a managed, project‑scoped datastore you control from the Database Manager — no server to provision, no schema migration scripts to write. This handbook covers where it lives, how to model tables and records, the field types, relations between tables, the API behind the UI, and fixes for the common problems.

> Short version: open [https://atai.ink/project/PROJECT_ID/database](https://atai.ink/project/PROJECT_ID/database), create a table, add fields (Text, Number, Boolean, Date, JSON, Relation), then add records. The same data is reachable from your generated app and via the REST API.

## 1. What the Database Manager is

The Database Manager is a built‑in, per‑project data layer. When Atai builds your business it often scaffolds tables for customers, orders, content, and so on; you can also create your own from scratch. It is:

- **Project‑scoped** — each project has its own isolated tables and records.
- **Schema‑flexible** — add/remove fields without writing migrations.
- **API‑backed** — every click in the UI maps to a REST endpoint you can call yourself.
- **Accessible from your app** — generated applications read and write these tables through the Runtime.

## 2. Where to find it

| View | URL |
|---|---|
| Tables list | [https://atai.ink/project/PROJECT_ID/database](https://atai.ink/project/PROJECT_ID/database) |
| A single table | [https://atai.ink/project/PROJECT_ID/database/TABLE_NAME](https://atai.ink/project/PROJECT_ID/database/TABLE_NAME) |

Replace `PROJECT_ID` with your project's id (visible in the workspace URL) and `TABLE_NAME` with the table's slug.

## 3. Tables

**Create a table**

1. Open [https://atai.ink/project/PROJECT_ID/database](https://atai.ink/project/PROJECT_ID/database).
2. Click **New table**, give it a name and (optionally) a description.
3. Add fields (see field types below).
4. Save — the table is immediately queryable.

**Edit / delete**

- Rename or adjust a table from its table page.
- Deleting a table removes its records; this is not reversible from the UI, so export first if needed.

Every table automatically carries three system fields you cannot edit:

| Field | Notes |
|---|---|
| `_id` | Unique record id |
| `createdAt` | Set when the record is created |
| `updatedAt` | Updated on every write |

## 4. Field types

When defining a field you choose its type:

| Type | Stores | Notes |
|---|---|---|
| **Text** | Short or long strings | Default type |
| **Number** | Integers / decimals | Rendered as a numeric input |
| **Boolean** | true / false | Toggle |
| **Date** | Date / datetime | Uses a datetime picker; stored as ISO |
| **JSON** | Arbitrary structured data | Useful for nested config |
| **Relation** | A link to a record in another table | See Relations below |

Fields of type **Relation** point at a target table (`objectReference.targetTable`) with a `relationType` (e.g. one‑to‑one, one‑to‑many). In the UI a relation field shows "Links to: <TargetTable>".

## 5. Records

**Create a record**

1. Open the table at [https://atai.ink/project/PROJECT_ID/database/TABLE_NAME](https://atai.ink/project/PROJECT_ID/database/TABLE_NAME).
2. Click **New record** (or **Add row**).
3. Fill each field; `_id`, `createdAt`, `updatedAt` are filled for you.
4. Save.

**Edit / delete**

- Open a record in the dialog to edit any non‑system field.
- Delete removes the single record. If other records **relate** to it, resolve or clear those links first to avoid dangling references.

## 6. Relations (linking records)

Relations let one table reference another — e.g. an `orders` table linking to a `customers` table.

- Add a **Relation** field to the child table and set its **target table**.
- When creating/editing a record, pick the related record from the target table.
- The link is stored as a reference; the UI shows "Links to: <TargetTable>".
- You can also create a link via the API: `POST /api/projects/[id]/database/records/[recordId]/link`.

Use relations instead of copying data: it keeps a single source of truth and makes queries cleaner.

## 7. The API behind the UI

Everything the Database Manager does is available over REST, so you can automate or integrate it:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/projects/[id]/database/tables` | List tables & their schema |
| `POST` | `/api/projects/[id]/database/tables` | Create a table |
| `GET` | `/api/projects/[id]/database/records` | List / query records |
| `POST` | `/api/projects/[id]/database/records` | Create a record |
| `GET` | `/api/projects/[id]/database/records/[recordId]` | Read one record |
| `PATCH` | `/api/projects/[id]/database/records/[recordId]` | Update a record |
| `DELETE` | `/api/projects/[id]/database/records/[recordId]` | Delete a record |
| `POST` | `/api/projects/[id]/database/records/[recordId]/link` | Create a relation link |
| `POST` | `/api/projects/[id]/database/query` | Run a query |

These endpoints are the same ones your generated application uses, so anything you can do in the UI you can do programmatically.

## 8. Using the data in your app

A business generated by Atai reads and writes these tables through the Runtime, so the Database Manager is the live source of truth your running app uses. Change a record in the manager and the running app sees it (subject to its own caching/refresh). For direct access from your own code, call the endpoints above or query through the Runtime `data` capability.

## 9. Common problems

### "Table not found" / 404 on the table URL
- *Cause:* `TABLE_NAME` in the URL is wrong, or the table was deleted.
- *Fix:* open [https://atai.ink/project/PROJECT_ID/database](https://atai.ink/project/PROJECT_ID/database) and click the table from the list to get the correct slug. Table names in URLs are slugs, not display names.

### Cannot edit `_id`, `createdAt` or `updatedAt`
- *Cause:* these are system fields maintained by Atai.
- *Fix:* this is expected — you cannot change them. If you need a stable business key, add your own **Text** field and manage it yourself.

### Relation field shows no records to link
- *Cause:* the target table is empty, or the relation's target table is misconfigured.
- *Fix:* create at least one record in the target table, then re‑open the relation field. Verify the field's target table setting in the table editor.

### Saved record missing / not appearing in the list
- *Cause:* filter applied, or you're looking at the wrong table/project.
- *Fix:* clear any filter on the records view, confirm the project id in the URL, and hard‑refresh. If created via API, check the response for the new `_id`.

### "Failed to save record" with no detail
- *Cause:* a field value violates its type (e.g. text in a Number field) or a required field is empty.
- *Fix:* check each field matches its type; for Number/Date/JSON fields ensure the format is valid. Re‑enter the value and save; if it persists, note the timestamp and contact [support@atai.ink](mailto:support@atai.ink).

### Deleted a table by accident
- *Cause:* table delete is immediate.
- *Fix:* there is no UI undo — restore from any export you made, or contact [support@atai.ink](mailto:support@atai.ink) to ask whether a backup exists for your plan.
