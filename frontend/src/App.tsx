import { BrowserRouter, Routes, Route } from "react-router-dom";
import ChatView from "./components/chat/ChatView";
import Sidebar from "./components/sidebar/Sidebar";

export default function App() {
  return (
    <BrowserRouter>
      <div className="flex h-screen overflow-hidden">
        <Sidebar />
        <main className="flex-1 flex flex-col min-w-0">
          <Routes>
            <Route path="/" element={<ChatView />} />
            <Route path="/chat/:id" element={<ChatView />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
