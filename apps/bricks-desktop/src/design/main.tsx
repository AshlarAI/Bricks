import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../app.css'
import Showcase from './Showcase'

createRoot(document.getElementById('app')!).render(
  <StrictMode>
    <Showcase />
  </StrictMode>,
)
