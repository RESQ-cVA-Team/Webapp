'use client';

import { useEffect, useRef, useState } from "react";
import { useChatStore } from "@/store/useChatStore";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area"
import type { ChartDTO } from "@/models/dto/charts";
import { isVisualizationResponseDTO, type StatisticalTestResultDTO, type VisualizationResponseDTO } from "@/models/dto/response";
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
  const setSelectedStatisticsIndex = useChatStore((s) => s.setSelectedStatisticsIndex);
  const selectedChartIndex = useChatStore((s) => s.selectedChartIndex);
  const selectedStatisticsIndex = useChatStore((s) => s.selectedStatisticsIndex);
  const visualization = useChatStore((s) => s.visualization);
  const { t } = useTranslation('common');

  const chartRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    if (!currentThreadId) {
      clearHistory();
      setVisualization(null);
      setSelectedChartIndex(null);
      setSelectedStatisticsIndex(null);
      return;
    }

    clearHistory();
    setSelectedChartIndex(null);
    setSelectedStatisticsIndex(null);

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
  }, [clearHistory, currentThreadId, setHistory, setSelectedChartIndex, setSelectedStatisticsIndex, setVisualization]);

  // Clear refs when display history changes
  useEffect(() => {
    chartRefs.current = [];
  }, [history]);

  useEffect(() => {
    if (history.length > 0 && !visualization) {
      const firstViz = history[0];
      if (firstViz?.charts && firstViz.charts.length > 0) {
        setVisualization(firstViz);
        setSelectedChartIndex(0);
        setSelectedStatisticsIndex(null);
      } else if (firstViz?.stats && firstViz.stats.length > 0) {
        setVisualization(firstViz);
        setSelectedChartIndex(null);
        setSelectedStatisticsIndex(0);
      }
    }
  }, [history, setSelectedChartIndex, setSelectedStatisticsIndex, setVisualization, visualization]);

  useEffect(() => {
    if ((selectedChartIndex !== null || selectedStatisticsIndex !== null) && visualization) {
      const historyIndex = history.findIndex((h) => h === visualization);
      const refKey = selectedChartIndex !== null
        ? `${historyIndex}-chart-${selectedChartIndex}`
        : `${historyIndex}-stat-${selectedStatisticsIndex}`;
      const ref = chartRefs.current.find((el) => el?.dataset.refkey === refKey);
      if (ref) {
        ref.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
      }
    }
  }, [history, selectedChartIndex, selectedStatisticsIndex, visualization]);

  const handleChartClick = (viz: VisualizationResponseDTO, chartIndex: number) => {
    setVisualization(viz);
    setSelectedChartIndex(chartIndex);
    setSelectedStatisticsIndex(null);
  };

  const handleStatClick = (viz: VisualizationResponseDTO, statIndex: number) => {
    setVisualization(viz);
    setSelectedChartIndex(null);
    setSelectedStatisticsIndex(statIndex);
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

  const cardHeight = Math.max(100, containerDimensions.height - 60);
  const cardWidth = Math.max(180, cardHeight * 0.75);
  
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
              const stats = (viz.stats ?? []) as StatisticalTestResultDTO[];

              const chartItems = charts.map((item, chartIndex) => {
                const refKey = `${historyIndex}-chart-${chartIndex}`;
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
                        onClick={() => handleChartClick(viz, chartIndex)}
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

              const statItems = stats.map((item, statIndex) => {
                const refKey = `${historyIndex}-stat-${statIndex}`;
                const isSelected = visualization === viz && selectedStatisticsIndex === statIndex;
                const statusLabel = item.status
                  ? `${item.status.charAt(0).toUpperCase()}${item.status.slice(1)}`
                  : "Unknown";
                return (
                  <Tooltip key={`${historyIndex}-stat-${statIndex}`}>
                    <TooltipTrigger asChild>
                      <div
                        ref={(el) => {
                          if (el) {
                            el.dataset.refkey = refKey;
                            chartRefs.current.push(el);
                          }
                        }}
                        onClick={() => handleStatClick(viz, statIndex)}
                        style={{
                          width: `${cardWidth}px`,
                          height: `${cardHeight}px`,
                        }}
                        className={clsx(
                          "cursor-pointer transition-all duration-300 flex-shrink-0 min-h-0 flex items-center justify-center ",
                          isSelected ? "ring-3 ring-blue-500 scale-[1.02]" : "hover:ring- hover:ring-muted"
                        )}
                      >
                        <div className="w-full h-full flex flex-col justify-between border hover:bg-black/5 p-3">
                          <div className="text-xs uppercase text-muted-foreground">{t('visualization.title')}</div>
                          <div className="text-sm font-semibold line-clamp-2">{item.title || item.test_type}</div>
                          <div className="text-xs text-muted-foreground">{statusLabel}</div>
                        </div>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      <div className="flex flex-col gap-1 ">
                        <div className="font-semibold">{item.title || item.test_type}</div>
                        <div className="text-xs">{item.reason || "No details"}</div>
                      </div>
                    </TooltipContent>
                  </Tooltip>
                );
              });

              return [...chartItems, ...statItems];
            })}
          </TooltipProvider>
        </div>
        <ScrollBar orientation="horizontal" className="w-80%" />
      </ScrollArea>
    </div>
  );
}
