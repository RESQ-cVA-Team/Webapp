import { NextResponse } from "next/server";
import { MESSAGE_FEEDBACK_VERSION_ENDPOINT, isMessageFeedbackEnabled } from "@/lib/feedbackConfig";

export async function GET() {
  return NextResponse.json({
    service: "webapp",
    version: process.env.WEBAPP_VERSION ?? process.env.npm_package_version ?? null,
    commitSha: process.env.WEBAPP_COMMIT_SHA ?? null,
    imageTag: process.env.WEBAPP_IMAGE_TAG ?? null,
    buildDate: process.env.WEBAPP_BUILD_DATE ?? null,
    environment: process.env.NODE_ENV,
    feedbackEnabled: isMessageFeedbackEnabled(),
    versionEndpoint: MESSAGE_FEEDBACK_VERSION_ENDPOINT,
  });
}