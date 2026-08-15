interface Props {
  actionCount: number;
}

export function Footer({ actionCount }: Props) {
  return (
    <div className="popup-footer">
      <span>
        Actions: <span className="action-count">{actionCount}</span>
      </span>
      <span>v0.1.0</span>
    </div>
  );
}
