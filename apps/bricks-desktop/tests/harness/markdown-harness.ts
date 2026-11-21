// Real-browser harness of the assistant-message renderer (Sprint 14.5).
// Dev server only: `npm run dev`, then /tests/harness/markdown.html. Not bundled.
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/app.css'
import MarkdownHarness from './MarkdownHarness'

createRoot(document.getElementById('app')!).render(createElement(MarkdownHarness))
