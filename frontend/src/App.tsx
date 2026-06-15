import { useEffect } from "react";
import Sidebar from "./components/sidebar/Sidebar";
import ChatView from "./components/chat/ChatView";
import { useConversationStore } from "./stores/conversationStore";

export default function App() {
  const loadList = useConversationStore((s) => s.loadList);

  useEffect(() => {
    loadList();
  }, [loadList]);

  return (
    <div className="flex h-screen overflow-hidden bg-surface text-text-primary">
      <Sidebar />
      <main className="flex-1 flex flex-col min-w-0">
        <ChatView />
      </main>
    </div>
  );
}
