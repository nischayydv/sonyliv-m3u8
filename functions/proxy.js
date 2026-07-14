// functions/proxy.js

export async function onRequest(context) {
    const { request } = context;
    const url = new URL(request.url);
    const targetUrl = url.searchParams.get('url');

    // Enable CORS so the browser can play it
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Accept',
    };

    // Handle OPTIONS request for CORS preflight
    if (request.method === "OPTIONS") {
        return new Response(null, { headers: corsHeaders });
    }

    if (!targetUrl) {
        return new Response("Error: Missing 'url' parameter. Usage: /proxy?url=YOUR_URL", { status: 400, headers: corsHeaders });
    }

    try {
        // Fetch the m3u8 mimicking VLC User-Agent
        const targetResponse = await fetch(targetUrl, {
            headers: {
                'User-Agent': 'VLC/3.0.18 LibVLC/3.0.18',
                'Accept': '*/*'
            }
        });

        if (!targetResponse.ok) {
            return new Response(`Error fetching stream: ${targetResponse.status}`, { status: targetResponse.status, headers: corsHeaders });
        }

        const manifestContent = await targetResponse.text();
        
        // Parse URL to rewrite relative paths to absolute paths
        const parsedTargetUrl = new URL(targetUrl);
        const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);
        const queryStr = parsedTargetUrl.search;

        const lines = manifestContent.split('\n');
        const rewrittenLines = lines.map(line => {
            const tLine = line.trim();
            if (tLine && !tLine.startsWith('#')) {
                // If it's a relative URL segment (.ts file or another .m3u8)
                if (!tLine.startsWith('http://') && !tLine.startsWith('https://')) {
                    if (tLine.startsWith('/')) {
                        return `${parsedTargetUrl.origin}${tLine}${queryStr}`; // Absolute path
                    } else {
                        return `${baseUrl}${tLine}${queryStr}`; // Relative path
                    }
                }
            }
            return line;
        });

        const finalM3u8 = rewrittenLines.join('\n');

        return new Response(finalM3u8, {
            headers: {
                ...corsHeaders,
                'Content-Type': 'application/vnd.apple.mpegurl',
            }
        });

    } catch (error) {
        return new Response(`Failed to fetch manifest: ${error.message}`, { status: 500, headers: corsHeaders });
    }
}
