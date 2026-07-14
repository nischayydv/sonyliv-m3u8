// functions/live.js ya Cloudflare Worker Script

export async function onRequest(context) {
    const { request } = context;
    const url = new URL(request.url);
    
    // Player se target m3u8 link uthana
    const targetUrl = url.searchParams.get('url');

    // Browsers ke liye CORS bypass headers
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Accept',
    };

    // Preflight requests ko handle karna
    if (request.method === "OPTIONS") {
        return new Response(null, { headers: corsHeaders });
    }

    if (!targetUrl) {
        return new Response("Error: Missing 'url' parameter. Usage: ?url=YOUR_M3U8_URL", { 
            status: 400, 
            headers: corsHeaders 
        });
    }

    try {
        // VLC player ke roop me request bhejna
        const vlcHeaders = {
            'User-Agent': 'VLC/3.0.18 LibVLC/3.0.18',
            'Accept': '*/*'
        };

        const response = await fetch(targetUrl, { headers: vlcHeaders });
        
        if (!response.ok) {
            return new Response(`Remote server error: ${response.status}`, { 
                status: response.status, 
                headers: corsHeaders 
            });
        }

        const contentType = response.headers.get('content-type') || '';
        
        // Yeh check karne ke liye ki request Playlist (.m3u8) ki hai ya Video (.ts) ki
        const isPlaylist = targetUrl.includes('.m3u8') || 
                           contentType.includes('mpegurl') || 
                           contentType.includes('application/x-mpegurl');

        if (isPlaylist) {
            // --- PLAYLIST LAYER (Master aur Sub-playlists dono ke liye) ---
            const manifestContent = await response.text();
            
            const parsedTargetUrl = new URL(targetUrl);
            const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);
            const queryStr = parsedTargetUrl.search; // Tokens jaise ?hdnea=... ko save rakhna

            const lines = manifestContent.split('\n');
            const rewrittenLines = lines.map(line => {
                const tLine = line.trim();
                
                // Agar line koi link hai aur comment (#) nahi hai
                if (tLine && !tLine.startsWith('#')) {
                    let fullUrl = tLine;
                    
                    // Relative paths ko Full Remote Absolute URL me badalna
                    if (!tLine.startsWith('http://') && !tLine.startsWith('https://')) {
                        if (tLine.startsWith('/')) {
                            fullUrl = `${parsedTargetUrl.origin}${tLine}${queryStr}`;
                        } else {
                            fullUrl = `${baseUrl}${tLine}${queryStr}`;
                        }
                    }
                    
                    // Wapas isi Cloudflare Edge endpoint par point mod dena
                    return `${url.origin}${url.pathname}?url=${encodeURIComponent(fullUrl)}`;
                }
                return line;
            });

            return new Response(rewrittenLines.join('\n'), {
                headers: {
                    ...corsHeaders,
                    'Content-Type': 'application/vnd.apple.mpegurl'
                }
            });

        } else {
            // --- VIDEO CHUNK LAYER (.ts files) ---
            // Cloudflare 'response.body' ko bina memory me load kiye direct stream pipe kar deta hai!
            return new Response(response.body, {
                status: response.status,
                headers: {
                    ...corsHeaders,
                    'Content-Type': response.headers.get('Content-Type') || 'video/mp2t',
                    'Cache-Control': 'public, max-age=10' // Chhote chunks ko 10s cache karna efficiency badhata hai
                }
            });
        }

    } catch (error) {
        return new Response(`Cloudflare Proxy Error: ${error.message}`, { 
            status: 500, 
            headers: corsHeaders 
        });
    }
}

// Workers ke liye compatibility layer (agar aap Pages ki jagah Worker me daal rahe hain)
export default {
    async fetch(request, env, ctx) {
        return onRequest({ request });
    }
};
