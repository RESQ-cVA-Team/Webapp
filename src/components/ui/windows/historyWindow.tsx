'use client';

import { useEffect, useRef, useState } from "react";
import { useChatStore } from "@/store/useChatStore";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area"
// import { ScrollArea } from "@radix-ui/react-scroll-area";
import type { ChartDTO } from "@/models/dto/charts";
import { isVisualizationResponseDTO, type VisualizationResponseDTO } from "@/models/dto/response";
import clsx from "clsx";
import { useTranslation } from 'react-i18next';
import '@/i18n';
import { ChartThumbnail } from "@/components/ui/chart-thumbnail";
import { useThread } from "@/components/ThreadContext";
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from "../tooltip";

export default function HistoryWindow() {
  const { currentThreadId } = useThread();
  const history = useChatStore((s) => s.history);
  const setHistory = useChatStore((s) => s.setHistory);
  const clearHistory = useChatStore((s) => s.clearHistory);
  const setVisualization = useChatStore((s) => s.setVisualization);
  const setSelectedChartIndex = useChatStore((s) => s.setSelectedChartIndex);
  const selectedChartIndex = useChatStore((s) => s.selectedChartIndex);
  const visualization = useChatStore((s) => s.visualization);
  const { t } = useTranslation('common');

  const chartRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Fetch visualization history from API
  useEffect(() => {
    if (!currentThreadId) {
      clearHistory();
      setVisualization(null);
      setSelectedChartIndex(null);
      return;
    }

    clearHistory();
    setSelectedChartIndex(null);

    const fetchVisualizationHistory = async () => {
      try {
        const res = await fetch(`/api/rasa/history?threadId=${currentThreadId}`, {
          credentials: "include",
          cache: "no-store",
        });
        if (!res.ok) return;

        const data = await res.json();
        const visualizations: VisualizationResponseDTO[] = [];
        
        (data.history || []).forEach((item: { custom?: unknown }) => {
          if (isVisualizationResponseDTO(item.custom)) {
            visualizations.push(item.custom);
          }
        });

        setHistory(visualizations);
      } catch (err) {
        console.error("Failed to fetch visualization history:", err);
      }
    };

    fetchVisualizationHistory();
  }, [clearHistory, currentThreadId, setHistory, setSelectedChartIndex, setVisualization]);

  // Clear refs when display history changes
  useEffect(() => {
    chartRefs.current = [];
  }, [history]);

  // Auto-select first chart when history is updated
  useEffect(() => {
    if (history.length > 0 && !visualization) {
      const firstViz = history[0];
      if (firstViz?.charts && firstViz.charts.length > 0) {
        setVisualization(firstViz);
        setSelectedChartIndex(0);
      }
    }
  }, [history, setSelectedChartIndex, setVisualization, visualization]);

  // Scroll selected chart into view
  useEffect(() => {
    if (selectedChartIndex !== null && visualization) {
      const historyIndex = history.findIndex((h) => h === visualization);
      const refKey = `${historyIndex}-${selectedChartIndex}`;
      const ref = chartRefs.current.find((el) => el?.dataset.refkey === refKey);
      if (ref) {
        ref.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
      }
    }
  }, [history, selectedChartIndex, visualization]);

  const handleClick = (viz: VisualizationResponseDTO, chartIndex: number) => {
    setVisualization(viz);
    setSelectedChartIndex(chartIndex);
  };


  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerDimensions, setContainerDimensions] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        const { width, height } = containerRef.current.getBoundingClientRect();
        setContainerDimensions({ width, height });
      }
    };

    const observedElement = containerRef.current;
    let resizeObserver: ResizeObserver | null = null;
    if (observedElement) {
      resizeObserver = new ResizeObserver(updateDimensions);
      resizeObserver.observe(observedElement);
    }
    updateDimensions();

    window.addEventListener("resize", updateDimensions);

    return () => {
      window.removeEventListener("resize", updateDimensions);
      if (resizeObserver && observedElement) {
        resizeObserver.unobserve(observedElement);
      }
    };
  }, []);

  // Calculate card dimensions based on container height
  const cardHeight = Math.max(100, containerDimensions.height - 60); // 60px for padding and title
  const cardWidth = Math.max(180, cardHeight * 0.75); // Maintain 4:3 aspect ratio, minimum 180px for readability
  
  const scrollRef = useRef<HTMLDivElement>(null);

  return (
    <div ref={containerRef} className="w-full h-full flex flex-col p-4">
      <p className=" font-semibold text-primary">{t('history.title')}</p>
      <ScrollArea
        ref={scrollRef}
        className="w-full flex-1"
        onWheel={(e) => {
          const viewport = scrollRef.current?.querySelector(
          "[data-radix-scroll-area-viewport]"
          ) as HTMLDivElement | null;

          if (!viewport) return;

          if (viewport.scrollWidth > viewport.clientWidth) {
            e.preventDefault();
            viewport.scrollLeft += e.deltaY;
          }
        }}
      >
        <div ref={scrollRef}className="flex flex-1 flex-row gap-2 p-2">
          <TooltipProvider>
            {history.map((viz, historyIndex) => {
              const charts = (viz.charts ?? []) as ChartDTO[];
                return charts.map((item, chartIndex) => {
                  const refKey = `${historyIndex}-${chartIndex}`;
                  const isSelected = visualization === viz && selectedChartIndex === chartIndex;
                    return (
                      <Tooltip key={`${historyIndex}-${chartIndex}`}>
                        <TooltipTrigger asChild>
                          <div
                            ref={(el) => {
                              if (el) {
                                  el.dataset.refkey = refKey;
                                  chartRefs.current.push(el);
                              }
                            }}
                            onClick={() => handleClick(viz, chartIndex)}
                            style={{
                              width: `${cardWidth}px`,
                              height: `${cardHeight}px`,
                            }}
                            className={clsx(
                              "cursor-pointer transition-all duration-300 flex-shrink-0 min-h-0 flex items-center justify-center ",
                              isSelected ? "ring-3 ring-blue-500 scale-[1.02]" : "hover:ring- hover:ring-muted"
                            )}
                          >
                            <div className="w-full h-full flex flex-col justify-between border hover:bg-black/5">
                              <div className="w-full flex-1 min-w-0 flex items-center justify-center overflow-hidden">
                                <div className="w-4/5 h-4/5">
                                  <ChartThumbnail chart={item} />
                                </div>
                              </div>
                              <div className="p-4 text-sm flex flex-col flex-shrink-0 flex-grow-0">
                                <div className="font-semibold truncate">{item.metadata?.title ?? 'Untitled'}</div>
                                <div className="text-xs text-muted-foreground truncate">
                                  {item.type === "BOX" && t('visualization.type.box')}
                                  {item.type === "LINE" && t('visualization.type.line')}
                                  {item.type === "AREA" && t('visualization.type.area')}
                                  {item.type === "BAR" && t('visualization.type.bar')}
                                  {item.type === "PIE" && t('visualization.type.pie')}
                                  {item.type === "RADAR" && t('visualization.type.radar')}
                                  {item.type !== "BOX" && item.type !== "LINE" && item.type !== "AREA" && item.type !== "BAR" && item.type !== "PIE" && item.type !== "RADAR" && (<>{item.type}</>)}
                                </div>
                              </div>
                            </div>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>
                          <div className="flex flex-col gap-1 ">
                            <div className="font-semibold">{item.metadata?.title ?? 'Untitled'}</div>
                            <div className="text-xs">{item.metadata?.description ?? 'None'}</div>
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    );
              });
          })}
          </TooltipProvider>
        </div>
        <ScrollBar orientation="horizontal" className="w-80%" />
      </ScrollArea>
    </div>
  );
}
