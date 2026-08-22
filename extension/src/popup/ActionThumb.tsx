// Hovering shows the step's full captured screenshot at a readable size.
// Clicking used to open it in a new tab, but Chrome silently blocks a new
// tab navigating straight to a data: URL (it just lands on about:blank), so
// this shows the enlarged copy inline instead — no navigation involved.
export function ActionThumb({ dataUrl }: { dataUrl?: string }) {
  if (!dataUrl) return null;

  return (
    <span className="action-thumb-wrap">
      <img className="action-thumb" src={dataUrl} alt="" />
      <img className="action-thumb-preview" src={dataUrl} alt="" />
    </span>
  );
}
