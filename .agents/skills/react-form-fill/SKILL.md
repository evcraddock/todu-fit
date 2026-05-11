---
name: react-form-fill
description: Fill React-controlled form inputs via browser automation. Use when setting input.value directly doesn't work on React forms, or when you need to programmatically fill forms in this web app.
---

# React Form Fill

React intercepts the native `value` setter on inputs. Setting `input.value = "text"` directly won't trigger React's state updates. Use the native setter instead.

## Input Fields

```javascript
(function() {
  var input = document.querySelector("SELECTOR");
  var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(input, "VALUE");
  input.dispatchEvent(new Event("input", { bubbles: true }));
})()
```

## Textarea Fields

```javascript
(function() {
  var textarea = document.querySelector("SELECTOR");
  var setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
  setter.call(textarea, "VALUE");
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
})()
```

## Usage with browser-eval

```bash
browser-eval.js '(function() { var i = document.querySelector("input[type=email]"); var s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set; s.call(i, "user@example.com"); i.dispatchEvent(new Event("input", { bubbles: true })); })()'
```

## Common Selectors

| Field Type | Selector |
|------------|----------|
| Email | `input[type=email]` |
| Password | `input[type=password]` |
| Text by name | `input[name="fieldName"]` |
| Text by placeholder | `input[placeholder="Search..."]` |
| First input in form | `form input:first-of-type` |
