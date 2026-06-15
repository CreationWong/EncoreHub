export default function Sidebar() {
  return (
    <aside className="w-64 border-r flex flex-col h-full bg-surface-alt">
      <div className="p-4 border-b">{/* Logo + new chat */}</div>
      <div className="flex-1 overflow-y-auto p-2">{/* Conversation list */}</div>
      <div className="p-2 border-t">{/* User / settings */}</div>
    </aside>
  );
}
