# 🦊 PlexiEnhancer (formerly PlexiCopy)

**Clean up and enhance your Perplexity workflow.** PlexiCopy is now officially **PlexiEnhancer**—a Firefox extension designed to give you perfectly sanitized copies of AI answers (free of citation markers, bulk URLs, and messy formatting) and keep the model you actually chose.

Perplexity has a tendency to silently reset your selected model back to cheap defaults (like "Best", "Model", or "Pro") even within a single chat session to reduce server-side costs. PlexiEnhancer remembers the model you picked in each tab and switches back when Perplexity resets it. A model you pick by hand always wins.

### ⬇️ [Get it on Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/plexienhancer/)

---

### ✨ Features & Workflow Guide

#### 🚀 Model Keeper
All model options are in the toolbar popup:
- **Keep tab's manual pick** (on by default): when you pick a model by hand, that tab remembers it, even across reloads. If Perplexity resets it, PlexiEnhancer switches back. Each tab keeps its own model, so you can keep Claude in one tab and Kimi in another.
- **Apply favorite model** (off by default): new tabs start on your favorite model. Picking another model by hand overrides it for that tab.
- **Enforce thinking** (off by default): turns thinking on whenever the current model supports it. If you turn thinking off by hand, that tab is left alone.

To avoid fighting Perplexity in a loop, automatic switches are capped at 3 per minute.

#### 🧼 Smart Markdown Copying
Click the custom copy icon next to Perplexity's native copy button to get the answer in clean Markdown. It keeps all formatting (tables, bold text, headers, and code snippets) but completely deletes citation numbers (like [1], [2]) and the long list of source links at the bottom.

#### 📄 Plain Text Copying
Need the answer as clean, raw text without any formatting? Click the secondary copy icon to strip out all Markdown elements and citations instantly. The extension also normalizes inconsistent bullet points (like * or +) into a clean, uniform list format.

#### ⚡ Automatic Onboarding Setup
When landing on Perplexity for the first time, a setup card automatically opens. It lists all currently unlocked, available models from Perplexity and lets you pick a favorite model for new tabs and choose whether thinking should be enforced. 

#### 🛠️ UI Zen (Citation Hider & Ad Blocker)
Clean up the Perplexity layout to stay focused:
- Hide citation numbers and floating source badges throughout your answers.
- Remove the "Set up Computer" advertisement widget from the bottom-right corner of the page.





