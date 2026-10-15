import { Card, CardContent } from "@/components/ui/card";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import HistoryWindow from "@/components/ui/windows/historyWindow";
import ChatWindow from "@/components/ui/windows/chatWindow";
import VisualizationWindow from "@/components/ui/windows/visualizationWindow";

export default function HomePage() {
  return (
    <div className="h-full w-full flex-1 p-4 pl-1 pb-10">
      <ResizablePanelGroup direction="horizontal" defaultLayout={{ chat: 30, right: 70 }} className="h-full w-full">
        <ResizablePanel id="chat" defaultSize="30%" minSize="30%" collapsible>
          <div className="flex-auto h-full items-center justify-center p-2 pr-1 pl-0 ">
            <Card className="h-full w-full py-0  overflow-hidden">
                <CardContent className="h-full w-full p-0 ">
                    <ChatWindow />
                </CardContent>
            </Card>
          </div>
        </ResizablePanel>
        <ResizableHandle className="min-w-1 bg-transparent" />
        <ResizablePanel id="right" defaultSize="70%" minSize="15%" collapsible>
          <ResizablePanelGroup direction="vertical" defaultLayout={{ viz: 80, history: 20 }} className="h-full">
            <ResizablePanel id="viz" defaultSize="75%" minSize="25%" collapsible>
              <div className="flex h-full items-center justify-center pl-1 pb-1 p-2">
                <Card className="h-full w-full">
                    <CardContent className="h-full w-full">
                        <VisualizationWindow />
                    </CardContent>
                </Card>
              </div>
            </ResizablePanel>
            <ResizableHandle className="min-h-1 bg-transparent" />
            <ResizablePanel id="history" defaultSize="20%" minSize="20%" maxSize="20%" collapsible>
              <div className="flex h-full items-center justify-center p-2">
                <Card className="h-full w-full p-0">
                    <CardContent className="h-full w-full p-2">
                        <HistoryWindow />
                    </CardContent>
                </Card>
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  )
}