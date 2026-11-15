# Database Manager

Every app Atai builds comes with a built-in database you can see and edit yourself — no technical setup required. The Database Manager is where you view and manage that data: customers, orders, content, bookings, or anything else your app stores. This guide shows you how to use it in plain language.

> **New to Atai?** Start with the [Getting Started guide](/docs/onboarding). Building an app that reads this data? See the [Runtime & SDK guide](/docs/runtime-api).

## 1. What the Database Manager is

Think of it as a set of spreadsheets your app uses behind the scenes. Each **table** holds one kind of thing (for example, Customers or Orders), and each **record** is one row in that table.

The Database Manager lets you:

- **See** what your app is storing.
- **Add, edit, or delete** data.
- **Connect** related data (for example, linking an order to the customer who placed it).

You don't need to write any code or queries. If Atai built your app, the main tables are usually created for you.

### Why it matters

- **You own your data.** You can see and manage it directly, without asking a developer.
- **No setup.** There's no server to provision and no migration scripts to write.
- **It's live.** The data here is the same data your running app uses.

### What it is not

It's worth being clear about the limits, so you know when to ask for help:

- It's **not a spreadsheet** — there are no formulas in cells. Calculations belong in your app.
- It's **not a backup service** — deleting is immediate and there's no undo.
- It's **not a report builder** — but you can export and analyse data elsewhere.

For most small businesses, that's exactly the right trade-off: simple enough to use without training, structured enough that your app can rely on it.

## 2. Where to find it

Open your project, then click **Database** in the project menu. You'll see a list of tables; click one to view its records.

If you don't see **Database**, make sure you've opened a project rather than your account dashboard. Tables belong to a project, not to your account.

## 3. Tables

A table is a collection of similar items — like a spreadsheet with one row per item.

### Create a table

1. Open **Database** in your project.
2. Click **New table** and give it a clear name (for example, "Customers").
3. Add the fields you need (see below).
4. Save — the table is ready to use right away.

### Naming tables

Use **plural, capitalised, human** names: `Customers`, `Orders`, `Bookings`. It reads better in lists and it's easier to describe to someone else ("the Orders table") than a name like `tbl_ord`.

Avoid names that will be ambiguous in six months: `Data`, `Items`, `Stuff`, `Test`. If you need a scratch table, call it `Test — delete me` so future-you knows.

### Rename or delete

- Rename or adjust a table from its table page.
- Deleting a table also deletes its records, and this can't be undone — export or back up anything important first.

### System fields

Every table keeps a few **system fields** that Atai manages for you: a unique ID for each record, and created / last-updated timestamps. You can't edit these, and you don't need to.

They exist because your app needs a stable way to refer to a record even if you rename it. That's why the ID never changes, even when you edit every other field.

## 4. Field types

When you add a field, choose the kind of information it holds.

| Type | Stores | Example |
|---|---|---|
| **Text** | Words, names, descriptions | A customer's name, a product description |
| **Number** | Amounts, quantities | Price, quantity in stock |
| **Yes/No** | A simple toggle | "Is this order paid?" |
| **Date** | A date, or a date and time | Booking date, signup date |
| **Structured** | Flexible data for advanced use | A list of tags or options |
| **Link** | A connection to a record in another table | Linking an order to a customer |

> **Tip:** Choose the type that matches your data. A Number field for prices makes totals and sorting work correctly; a Text field for everything makes it harder to use later.

### Choosing the right type

The type decides what your app can do with a value, so it's worth a moment's thought:

- **Text** if it's for reading, not calculating. Names, notes, descriptions, phone numbers.
- **Number** if you'll ever add it up, compare it, or sort it. Prices, quantities, ages, scores.
- **Yes/No** if there are exactly two states. Paid or not. Active or not. Don't use Text for this — "yes", "Yes", "Y" and "true" are four different values to a computer.
- **Date** if you'll sort chronologically or filter by period. Use it for anything that is a point in time.
- **Structured** when you need a small bundle of related values — a list of tags, or a set of options — without creating another table.
- **Link** whenever one thing belongs to another. Orders belong to customers; bookings belong to services.

### A note on money

Store prices as **Number**, not Text. If you need exact currency handling, keep the amount as a number and store the currency separately as Text. Never mix symbols into a Number field — an amount with a currency symbol attached won't save as a number.

## 5. Records

A record is one entry in a table — one customer, one order, one booking.

### Add a record

1. Open the table.
2. Click **New record** (or **Add row**).
3. Fill in the fields and save.

### Edit or delete

- Open a record and edit any field.
- Use **Delete** to remove it. If other records are linked to it, clear those links first so nothing is left pointing at something that no longer exists.

### Finding a record

Once a table has more than a screenful of rows, scanning gets slow. Most tables let you:

- **Search** by typing part of a value — useful for names, emails, and reference numbers.
- **Sort** by a column, for example newest first, or highest amount first.
- **Filter** to a subset, for example "unpaid orders" or "bookings this week".

If you can't find a record you know exists, clear any filters first. A hidden filter is the most common reason for "it disappeared".

## 6. Linking records

Linking lets one table point to another — for example, an Orders table linking each order to a Customer.

### How it works

1. Add a **Link** field to the table.
2. Choose the table it connects to (the "target").
3. When you create or edit a record, pick the related record from that table.

### Why links are better than copying

If you copy a customer's name into every order, you have to update it in many places when it changes. With a link, there's one source of truth — update the customer once and every order sees the change.

There's a second benefit that matters more as you grow: with links, you can ask questions like "how many orders does this customer have?" Copying can't answer that reliably, because the copies drift apart.

### Examples

- **Orders → Customers:** each order points to the customer who placed it.
- **Bookings → Services:** each booking points to the service being booked.
- **Posts → Authors:** each post points to the person who wrote it.
- **Invoices → Orders:** each invoice points to the order it bills for.

### One-to-many and many-to-many

Most relationships are **one-to-many**: one customer has many orders, but each order belongs to one customer. You model that by putting the link on the "many" side — the Orders table holds the link to Customers, not the other way round.

**Many-to-many** is rarer: a product can appear in many orders, and an order can contain many products. You model it with a middle table — `Order items` — where each row links one order to one product, plus the quantity. This feels like extra work, but it's the only shape that stays correct when an order has more than one product.

## 7. Designing good tables

A little planning makes your data much easier to use.

### Start with the things, not the screens

Ask: "What kinds of things does my business keep track of?" Customers, orders, products, bookings, messages. Each kind is usually one table.

If you start from screens instead ("the dashboard needs a chart"), you end up with tables shaped like pages, which are painful to change later. Start from the things; the screens can always be rearranged.

### Keep one idea per field

Don't cram a full address into one Text field if you'll need to sort by city later. Split it into street, city, and postcode when it matters.

The test: will you ever want to sort, filter, or count by part of this value? If yes, split it out. If it's only ever read as a whole (a free-text note), keep it together.

### Use consistent names

Name fields clearly and consistently — "Email" everywhere, not "Email" in one table and "E-mail" in another.

Consistency also helps the AI: when every table uses the same field names, generated app code links them correctly.

### Add a reference number if you need one

System IDs are for the app. If you want a human-friendly reference (like an order number), add a Text field and fill it in yourself.

### Start small

Begin with the tables you actually need. You can always add more fields and tables later — no migrations required.

Adding a field is safe. Changing a field's *type* after it holds data is the risky operation — do that early, before there's much data, or create a new field and copy values across.

### A starter set by business type

| Business | Tables you probably need |
|---|---|
| **Service business / salon** | Customers, Services, Bookings, Staff |
| **Online shop** | Products, Orders, Order items, Customers |
| **Consultancy** | Clients, Projects, Time entries, Invoices |
| **Content / community** | Posts, Authors, Categories, Subscribers |
| **Events** | Events, Attendees, Tickets, Venues |

You don't need all of these on day one. Start with two and add as the need appears.

### A worked example: a salon

Say you run a two-person salon. A workable design:

- **Customers** — Name (Text), Phone (Text), Email (Text), Notes (Text).
- **Services** — Name (Text), Duration in minutes (Number), Price (Number).
- **Bookings** — Customer (Link → Customers), Service (Link → Services), When (Date), Completed (Yes/No), Paid (Yes/No).

With just those three tables you can answer: who's coming in tomorrow, which services earn the most, and who hasn't paid. That's most of what a small salon actually needs.

Notice what's *not* there: no "Address" crammed into Customers, no price copied into Bookings. The price comes from the Service through the link, so when you raise a price, every new booking uses the new one automatically.

## 8. Keeping your data clean and safe

- **Back up or export** important data regularly, especially before deleting a table.
- **Be careful with delete.** Deleting a record or table is immediate and can't be undone in the app.
- **Check your field types** if a save fails — a value that doesn't match its type won't save.
- **Clear links before deleting.** Remove references to a record before removing the record itself.

### Good habits that cost nothing

- **Fill in required fields.** A record with a blank name is nearly useless later.
- **Don't use one table for two things.** If half the rows have completely different fields, it's probably two tables.
- **Delete test records.** A table full of "test", "asdf", and "John Doe" makes real data harder to trust.
- **Keep a "how this is organised" note.** Two sentences in your project notes about what each table means saves hours later.
- **Export before bulk edits.** If you're about to change many records, take a copy first.

### Who can see this data

The Database Manager is for people with access to the project. Your app decides what end users can see — that's a separate concern, handled by how the app is built and who it lets sign in. Don't assume data is private just because it's not linked from a page; treat anything in the database as something a determined visitor might reach unless your app explicitly restricts it.

## 9. How your app uses this data

The data you see in the Database Manager is the same data your live app uses. Change a record here and your app will reflect it.

If Atai built your app, it's already connected to these tables. If you're building your own integration, the [Runtime & SDK guide](/docs/runtime-api) explains how your app can read and write this data.

### Why a change might not appear immediately

Apps often hold a copy of data in memory or in the browser for speed. After you edit a record:

- Refresh the app page.
- If it's still stale, wait a few seconds and refresh again.
- If it never updates, check the app is reading the table you edited — it's easy to have two similarly named tables.

### When to edit here versus in the app

Use the Database Manager when you need to **fix** something — a typo in a customer's name, a wrongly marked payment. Use the app when you're **doing normal work** — taking a booking, adding a product. Editing directly is powerful, but it skips whatever checks the app would have applied.

## 10. Common problems

### A table says "not found"
- *Cause:* the table was renamed or deleted, or you opened an old link.
- *Fix:* go back to the **Database** list in your project and open the table from there.

### I can't edit the ID or timestamps
- *Cause:* these are system fields managed by Atai.
- *Fix:* this is expected. If you need your own reference number, add a **Text** field and fill it in yourself.

### A link field shows no records to choose
- *Cause:* the other table is empty, or the link points to the wrong table.
- *Fix:* add at least one record to the other table, then try again. Check the link's target table in the field settings.

### I saved a record but don't see it
- *Cause:* a filter is hiding it, or you're looking at a different table.
- *Fix:* clear any filters, make sure you're in the right table and project, then refresh.

### I get "failed to save" with no detail
- *Cause:* a value doesn't match its field type (for example, text in a Number field), or a required field is empty.
- *Fix:* check each field matches its type and fill in anything required, then save again. If it keeps happening, contact support with the time it happened.

### A number won't save
- *Cause:* the value contains something that isn't a number — a currency symbol, a comma, or a space.
- *Fix:* enter digits only (and a decimal point if needed). Store the currency in its own Text field.

### I deleted a table by accident
- *Cause:* deleting a table is immediate.
- *Fix:* there's no undo in the app. Restore from a backup or export if you have one, or contact support to ask what's possible for your plan.

### I deleted a record by accident
- *Fix:* there's no undo. Restore from an export if you have one, or re-enter it. If other records linked to it, re-create the record and re-link them.

### My app doesn't show the data I added here
- *Cause:* the app may cache data, or you may be looking at a different project.
- *Fix:* refresh the app, confirm you're in the right project, and give it a moment to update.

### Two tables have almost the same name
- *Cause:* usually a table created twice during setup.
- *Fix:* check which one your app actually uses (it'll have the records), rename the other to something obvious like "Old — ignore", and delete it once you're sure.

## 11. Related guides

- **[Getting Started guide](/docs/onboarding)** — the full walkthrough from sign-up to launch.
- **[Runtime, SDK & API access](/docs/runtime-api)** — for reading and writing this data from code.
- **[Growth & marketing playbook](/docs/growth-marketing)** — using your customer data to grow.
- **[Troubleshooting & common problems](/docs/troubleshooting)** — quick fixes.
