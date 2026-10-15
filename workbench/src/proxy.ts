import { NextResponse, type NextRequest } from "next/server";

// Optimistic redirect for page requests without a session cookie.
// Real authorization happens in server code (requireUser / requireOwner).
const PUBLIC = ["/login", "/setup", "/offline", "/manifest.webmanifest", "/sw.js", "/icons", "/api/auth", "/api/health"];

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(p + "/"))) return NextResponse.next();
  if (pathname.startsWith("/_next") || pathname.startsWith("/api/")) return NextResponse.next();
  const hasSession = req.cookies.has("wb_session");
  if (!hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icons/).*)"],
};
