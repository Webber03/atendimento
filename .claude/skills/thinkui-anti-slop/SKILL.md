---
name: thinkui-anti-slop
description: "Stop AI agents shipping generic UI: settle each design decision with real captured screens, then pass a finish gate before calling it done. Use when building or redesigning any interface — landing page, dashboard, paywall, settings, onboarding, empty state, mobile screen; when a screen looks generic, templated or 'AI-generated'; when someone says the design feels default, ugly, boring or made by an LLM; or before you claim a UI task is complete. Pairs with the ThinkUI MCP server for evidence; the gate works without it."
license: MIT
metadata:
  version: "1.0.0"
  author: "ThinkUI <support@thinkui.xyz>"
  compatibility: "Any agent that can edit files. The evidence step needs the ThinkUI MCP server (https://thinkui.xyz/mcp, API key or OAuth); everything else runs without it."
  tags: "ui, design, anti-slop, frontend, mcp, design-review, paywall, dashboard"
---

# UI that looks decided

AI-generated UI fails in a predictable way: it reproduces the median of everything it has
seen. The median is a hero, three feature cards, a gradient headline, and a testimonial from
nobody. It is not ugly — that is what makes it hard to argue with. It is *undecided*: no
element wins, no state exists, no number is real.

Fix that with evidence and a gate, in that order.

## 1. One evidence call before you design

Do not start from taste. Ask the corpus the *decision* you are about to make, in the words of
the problem — not "design inspiration" and never "modern UI".

```
find_ui_references(query="how a paywall frames the free trial before the price", limit=3)
find_ui_references(query="dense transaction row showing remaining balance and date", limit=3)
find_ui_references(query="empty state that offers the first action, not an illustration alone", limit=3)
```

Then:

- **Settle one decision per call.** If you have three open questions, that is three calls, not
  one vague one.
- **Read what each result demonstrates**, not just the screenshot. Copying a layout from a
  different product is how slop starts again.
- **One strong reference is enough.** Stop searching when the decision is made.
- If a result is not answering the question, re-query with the product's own vocabulary
  ("ledger", "standings", "shift handover") rather than design jargon.

Without a key: say plainly that the evidence step was skipped, and proceed to the gate below.
Do not invent a reference or describe a screenshot you did not receive.

## 2. Design the states before the happy path

Four states, every screen that loads data:

| State | The test |
|---|---|
| Empty | Is the first action obvious, or is it a grey rectangle saying "No data"? |
| Loading | Does it hold the layout, or does the page jump when data arrives? |
| Error | Can the user retry, and is it clear *what* failed? |
| Overflow | A name three times longer than expected, a 9-figure number, 60 rows on a phone. |

Add a fifth if the screen is long: the narrow viewport, checked with real content in place.

## 3. Real content, not placeholders

"John Doe", "Acme Inc" and "$1,234.56" hide every layout bug worth catching. Pull real names,
real numbers and real long strings from the project; if there are none, invent the *shape* —
a 34-character name, a negative balance, an emoji in a display name — and design for it.

## 4. One element wins

Every screen has one job. If a title, a card and a button are all the same weight, none of them
is the answer. Decide which element the eye should hit first, and make the rest recede with
size, weight or space — not with more colour.

## 5. Tokens before values

If the project has a design system, extend it. Reach for `--space-4` and the existing scale
before writing `margin: 13px`. A screen that invents its own spacing is a screen that will
drift on the next edit.

## 6. Render it and look at it

A passing build is not a looked-at page. Open it, screenshot it at a phone width and a desktop
width, and check the states above with real content. If you cannot render it, say so — do not
claim a visual result you have not seen.

## The gate

Before you say the UI is done, answer these in one line each. A "no" is the remaining work, not
a reason to lower the bar.

1. **Specific** — would this screen make sense for a competitor's product unchanged? If yes,
   nothing here is about this product yet.
2. **Evidence** — which decision did the reference settle, and what did it change?
3. **States** — empty, loading, error, overflow: seen with real content?
4. **Content** — any placeholder names or fake round numbers left in the markup?
5. **Hierarchy** — name the one element that wins. Can you name it without looking? Could a
   stranger?
6. **Honest limits** — what did you not render, not test, or not fix?

## Reporting back

Three lines, no process narration:

```
Decision: <what the reference settled>
Changed:  <files, states, tokens>
Unverified: <what you could not render or test>
```

## Setup

```json
{
  "mcpServers": {
    "thinkui": {
      "url": "https://thinkui.xyz/mcp",
      "headers": { "Authorization": "Bearer ${THINKUI_KEY}" }
    }
  }
}
```

Keys at https://thinkui.xyz/account · docs at https://thinkui.xyz/docs · the server also
supports OAuth, so clients that discover `.well-known` need no key pasted.
