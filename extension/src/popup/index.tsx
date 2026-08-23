import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ReportComposerPage } from './ReportComposerPage';

const params = new URLSearchParams(location.search);

// A toolbar popup is sized by its own stylesheet; the side panel is sized by
// the user dragging its edge. The stylesheet has to know which it is in.
if (params.has('side')) {
  document.documentElement.classList.add('in-side-panel');
}

const reportId = params.get('report');
if (reportId) {
  document.documentElement.classList.add('report-window');
}

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(reportId ? <ReportComposerPage recordingId={reportId} /> : <App />);
}
