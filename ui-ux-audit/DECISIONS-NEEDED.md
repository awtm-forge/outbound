# Decisions needed

Product questions that change behaviour, not only looks. For each, the default I built is marked, and none of the
defaults change what the app sends to the server.

## 1. Which theme people see first

| Option | What it is | Why it matters | If chosen |
|---|---|---|---|
| **Follow the system (built)** | Light or dark from the operating system, switchable in the sidebar and on Your account. | Most people's machines already say what they prefer. | Someone on a light Mac sees the new light theme the first time; one click returns them to dark. |
| Dark by default | Dark unless the person picks light. | The app has always been dark; nobody is surprised. | The light theme exists but most people never find it. |

## 2. Restoring an old wiki version

| Option | What it is | Why it matters | If chosen |
|---|---|---|---|
| **Ask first (built)** | "Restore version 2 of 'Leave policy'? It becomes the newest version; nothing is lost." | Restore replaces what everyone reads, and was one click with no confirmation. | One extra click; the same request is sent. |
| One click, as before | No confirmation. | Fastest. | An accidental click changes the page for everyone until someone notices. |

## 3. What a deal's "lost" step asks for

| Option | What it is | Why it matters | If chosen |
|---|---|---|---|
| **Reason required, in a dialog (built)** | Same rule as before (the server already refuses LOST without a reason); the dialog says so and the Mark lost button stays disabled until a reason is typed. | The old prompt cancelled silently if left empty. | Same requests, clearer. |
| Reason optional | Allow LOST with no reason. | Faster. | Needs a server change (the API requires a reason), and the weekly review loses its input. Not built. |

## 4. Where Today's to-dos sit

| Option | What it is | Why it matters | If chosen |
|---|---|---|---|
| **To-dos first, then outbound (built, as before)** | Your list, then what is waiting in outbound. | The founders asked for their work and to-dos front and centre. | No change. |
| Outbound first | Drafts and replies above to-dos. | Outbound has deadlines set by other people. | To-dos drop below the fold at 1024. |

## 5. Navigation on phones

| Option | What it is | Why it matters | If chosen |
|---|---|---|---|
| **Menu sheet (built)** | A top bar with the page name and a Menu button; the full navigation opens as a sheet. | All 14 destinations are one tap away; today 12 are hidden in a sideways strip. | One extra tap to switch screens. |
| Bottom tab bar | Five fixed tabs (Today, Inbox, Projects, Chat, Menu). | Faster for the five most used. | Needs a decision on which five; the rest stay behind Menu. |
