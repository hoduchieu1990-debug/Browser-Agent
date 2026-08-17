import { createRoot } from 'react-dom/client';
import { App } from './App';

// A toolbar popup is sized by its own stylesheet; the side panel is sized by
// the user dragging its edge. The stylesheet has to know which it is in.
if (new URLSearchParams(location.search).has('side')) {
  document.documentElement.classList.add('in-side-panel');
}

const container = document.getElementById('root');
if (container) createRoot(container).render(<App />);
