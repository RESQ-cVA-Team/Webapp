import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getCvaBaseUrl } from "@/lib/cvaConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getSubjectFromAccessToken(rawToken: string): string | null {
  const parts = rawToken.split(".");
  if (parts.length < 2) return null;

  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf-8")) as {
      sub?: unknown;
    };
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch(error) {
    console.error("Failed to parse access token payload", error);
    return null;
  }
}

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

export async function GET(req: NextRequest) {
  const session = await auth();

  if (!session?.accessToken) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const baseUrl = getCvaBaseUrl();
  const query = req.nextUrl.searchParams.toString();
  const upstreamUrl = `${baseUrl}/threads${query ? `?${query}` : ""}`;
  try {
    const res = await fetch(upstreamUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${String(session.accessToken)}`,
      },
      cache: "no-store",
    });
    if (!res.ok) {
      console.error(`Failed to fetch CVA threads: ${res.status} ${res.statusText}`, {
        upstreamUrl,
        status: res.status,
        statusText: res.statusText,
      });
    }
    return await forwardResponse(res);
  } catch (error) {
    console.error("Error fetching CVA threads", {
      upstreamUrl,
      error,
    });
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await auth();

  if (!session?.accessToken) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const body = await req.json();
  const subjectFromAccessToken = getSubjectFromAccessToken(String(session.accessToken));
  const subject = subjectFromAccessToken ?? session.user?.id ?? null;

  const payload =
    body && typeof body === "object"
      ? {
          ...(body as Record<string, unknown>),
          user:
            (body as Record<string, unknown>).user ??
            subject,
        }
      : { name: "Conversation", user: subject };

  if (!payload.user) {
    return NextResponse.json(
      { message: "Missing user subject for thread creation" },
      { status: 400 }
    );
  }

  const baseUrl = getCvaBaseUrl();
  try {
    const res = await fetch(`${baseUrl}/threads`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${String(session.accessToken)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error(`Failed to create CVA thread: ${res.status} ${res.statusText}`, {
        baseUrl,
        payload,
        status: res.status,
        statusText: res.statusText,
      });
    }
    return await forwardResponse(res);
  } catch (error) {
    console.error("Error creating CVA thread", {
      baseUrl,
      payload,
      error,
    });
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
