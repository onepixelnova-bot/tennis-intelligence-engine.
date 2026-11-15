import { NextRequest, NextResponse } from "next/server";

/**
 * Accès privé TIE (MVP) : authentification HTTP Basic côté serveur.
 * Les identifiants sont exclusivement fournis par les variables Netlify.
 * Si la configuration manque ou est faible, l'application reste fermée.
 */
function constantTimeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i++) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return diff === 0;
}

function unauthorized() {
  return new NextResponse("Authentification requise pour accéder à Tennis Intelligence Engine.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Tennis Intelligence Engine", charset="UTF-8"',
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}

export function middleware(request: NextRequest) {
  const username = process.env.TIE_ACCESS_USERNAME;
  const password = process.env.TIE_ACCESS_PASSWORD;

  // Fail closed : aucun accès tant que les secrets ne sont pas configurés.
  if (!username || username.length < 3 || !password || password.length < 16) {
    return new NextResponse(
      "TIE n'est pas encore configuré : définissez TIE_ACCESS_USERNAME et un TIE_ACCESS_PASSWORD d'au moins 16 caractères dans Netlify.",
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      }
    );
  }

  const authorization = request.headers.get("authorization") || "";
  const match = authorization.match(/^Basic\s+([A-Za-z0-9+/]+={0,2})$/i);
  if (!match) return unauthorized();

  let suppliedUsername = "";
  let suppliedPassword = "";
  try {
    const decoded = atob(match[1]);
    const separator = decoded.indexOf(":");
    if (separator < 0) return unauthorized();
    suppliedUsername = decoded.slice(0, separator);
    suppliedPassword = decoded.slice(separator + 1);
  } catch {
    return unauthorized();
  }

  if (
    !constantTimeEqual(suppliedUsername, username) ||
    !constantTimeEqual(suppliedPassword, password)
  ) {
    return unauthorized();
  }

  // Bloque les requêtes d'écriture provenant d'un autre site (protection CSRF).
  if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
    const origin = request.headers.get("origin");
    const host = request.headers.get("host");
    if (!origin || !host) {
      return new NextResponse("Origine de requête manquante.", {
        status: 403,
        headers: { "Cache-Control": "no-store" },
      });
    }
    try {
      if (new URL(origin).host !== host) {
        return new NextResponse("Requête inter-origines refusée.", {
          status: 403,
          headers: { "Cache-Control": "no-store" },
        });
      }
    } catch {
      return new NextResponse("Origine invalide.", {
        status: 403,
        headers: { "Cache-Control": "no-store" },
      });
    }
  }

  const response = NextResponse.next();
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt).*)"],
};
