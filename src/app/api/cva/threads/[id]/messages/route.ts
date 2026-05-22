import { getToken } from "next-auth/jwt";
import { NextRequest, NextResponse } from "next/server";
import { getCvaBaseUrl } from "@/lib/cvaConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = {
  params: Promise<{ id: string }>;
};

async function forwardResponse(res: Response) {
  const contentType = res.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  }

  const text = await res.text();
  return new NextResponse(text, {
    status: res.status,
    headers: contentType ? { "Content-Type": contentType } : undefined,
  });
}

export async function GET(req: NextRequest, { params }: Params) {
  const token = await getToken({ req });

  if (!token?.accessToken) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { id } = await params;
  const baseUrl = getCvaBaseUrl();
  const query = req.nextUrl.searchParams.toString();
  const upstreamUrl = `${baseUrl}/threads/${encodeURIComponent(id)}/messages${query ? `?${query}` : ""}`;
try { 
  const res = await fetch(upstreamUrl, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${String(token.accessToken)}`,
    },
    cache: "no-store",
  });
    if (!res.ok) {
      console.error(`Failed to fetch CVA thread messages: ${res.status} ${res.statusText}`, {
        upstreamUrl,
        status: res.status,
        statusText: res.statusText,
      }); 
    }
  return await forwardResponse(res);
} catch (error) {
  console.error("Error fetching CVA thread messages", {
    upstreamUrl,
    error,
  });
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}


export async function POST(req: NextRequest, { params }: Params) {
  const token = await getToken({ req });

  if (!token?.accessToken) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const body = await req.json();
  const payload = body && typeof body === "object" ? { ...(body as Record<string, unknown>) } : {};

  // the upstream API currently requires `content` to be an array; normalize any
  // single objects that slip through so callers don't constantly have to do it
  if (payload.content && !Array.isArray(payload.content)) {
    payload.content = [payload.content];
  }

  const { id } = await params;
  const baseUrl = getCvaBaseUrl();
try {
  const res = await fetch(`${baseUrl}/threads/${encodeURIComponent(id)}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${String(token.accessToken)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
    if (!res.ok) {console.error(`Failed to create CVA thread message: ${res.status} ${res.statusText}`, {
        baseUrl,
        payload,
        status: res.status,
        statusText: res.statusText,
      });
    }
  return await forwardResponse(res);
} catch (error) {
  console.error("Error posting CVA thread message", {
    upstreamUrl: `${baseUrl}/threads/${encodeURIComponent(id)}/messages`,
    payload,
    error,
  });
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
