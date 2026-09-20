# UI package

This package holds the first shared design tokens used by Live. Reusable,
presentation-focused components move here only after repeated workflows prove
their boundary; the initial channel components remain owned by Live.

It must not contain backend calls, receiver-specific logic, or live state
ownership. Dense real-time visualizations may expose canvas/WebGL primitives
through a stable component boundary.
