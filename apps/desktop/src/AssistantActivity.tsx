export function AssistantActivity({ text }: { text: string }) {
  return (
    <div className="assistant-activity" role="status">
      <span aria-hidden="true" className="assistant-spinner" />
      {text}
    </div>
  );
}
