export default function ChatView() {
  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-4">{/* Message list */}</div>
      <div className="border-t p-4">{/* Input box */}</div>
    </div>
  );
}
