import '@/app/globals.css';
import React from "react";
import { Poppins } from 'next/font/google';
import SessionRoot from "@/components/SessionRoot";
import TopBar from "@/components/ui/menus/topBarMenu";
import { cookies } from 'next/headers';
import { resources } from '@/locales/config';
import { SidebarProvider } from '@/components/ui/sidebar';
import { SideMenu } from '@/components/ui/menus/threadHistoryMenu';
import { Toaster } from '@/components/ui/sonner';
import { ThreadProvider } from '@/components/ThreadContext';

const poppins = Poppins({ subsets: ['latin'], weight: ['300','400','500','600','700'], display: 'swap' });

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const lang = (cookieStore.get('lang')?.value || 'en') as keyof typeof resources;
  const theme = cookieStore.get('theme')?.value || 'default';
  const dark = cookieStore.get('dark')?.value === 'true';

  const titleText = (resources[lang] || resources.en)["app.title"]; 

  const htmlAttrs: Record<string, string> = { lang };
  if (theme && theme !== 'default') htmlAttrs['data-theme'] = theme;
  const htmlClass = dark ? 'dark' : undefined;

  return (
    <html {...htmlAttrs} className={[htmlClass, poppins.className].filter(Boolean).join(' ')}>
      <head>
        <title>{titleText}</title>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body className="h-screen flex flex-col overflow-hidden">
        <SessionRoot>
          <TopBar />
          <ThreadProvider>
          <SidebarProvider defaultOpen={false} >
              <div className="flex flex-1 overflow-hidden">
              <SideMenu />
                <main className="flex-1 min-h-0 overflow-hidden">
                  {children}
              </main>
              <Toaster />
            </div>
          </SidebarProvider>
          </ThreadProvider>
        </SessionRoot>
      </body>
    </html>
  );
}