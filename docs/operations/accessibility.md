# Accessibility statement

This page records what the product does for accessibility, and what remains. The target is Web Content Accessibility
Guidelines (WCAG) 2.2 level AA for all non-canvas interface, and full keyboard use of the canvas
(section 7.3 of the [product requirements document](../PRD.md)).

## What works now

- **Keyboard on the canvas.** Focus the canvas, then press Tab and Shift+Tab to move between objects in reading order (top to bottom in rows, then left to right). Tab leaves the canvas after the last object. Press Enter to edit an object's text, the arrow keys to move the selection (hold Shift to move further), Delete to remove it, and Escape to clear the selection. If the selected object is off screen, the view moves to it.
- **Screen reader announcements.** When the keyboard moves to an object, a live region announces its type, its text, whether it's locked, and its place in the order, such as "Sticky note: Ship v1. 2 of 9."
- **Labelled controls.** Every button, field, and menu has a name. Dialogs use `role="dialog"` and `aria-modal`. Status and error messages use `role="alert"` or `role="status"`.
- **Tables and headings.** Data tables have captions and column headers.
- **Colour is never the only signal.** An overdue card says "Overdue" in text. Classification banners carry the marking as text.

## What remains

- **A formal audit.** The release plan (R2) includes an audit by a person using a screen reader. The team hasn't run one.
- **Connector and drawing objects.** Tab skips connectors and freehand drawings, because they have no text to read. Their existence shows in the object count only.
- **Moving objects between frames by keyboard.** The arrow keys move an object, but there's no command to drop it into a chosen frame.
- **Contrast of user-chosen colours.** People choose sticky note and shape colours. The product doesn't check text contrast against them.
- **Touch and pen.** The canvas accepts pointer events, but the team hasn't tested it on a tablet.

## Test it

The `e2e/cards.mjs` script checks that Tab selects an object and announces it, and that Shift+Tab moves back.
The unit tests in `apps/web/src/selection.test.ts` cover the reading order and the announcement text.
