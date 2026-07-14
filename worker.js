export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        
        // Player se target m3u8 link uthana (?url=...)
        const targetUrl = url.searchParams.get('url');

        // Browsers aur players ke liye CORS bypass headers
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
            return new Response("Error: Missing 'url' parameter. Usage: https://your-worker.workers.dev/?url=YOUR_M3U8_URL", { 
                status: 400, 
                headers: corsHeaders 
            });
        }

        try {
            // VLC player ke roop me request bhejna (Spoofing)
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
            
            // Check karna ki request Playlist (.m3u8) ki hai ya Video (.ts) ki
            const isPlaylist = targetUrl.includes('.m3u8') || 
                               contentType.includes('mpegurl') || 
                               contentType.includes('application/x-mpegurl');

            if (isPlaylist) {
                // --- PLAYLIST LAYER (Master & Sub-playlists) ---
                const manifestContent = await response.text();
                
                const parsedTargetUrl = new URL(targetUrl);
                const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);
                const queryStr = parsedTargetUrl.search; // Security tokens ko bacha kar rakhna

                const lines = manifestContent.split('\n');
                const rewrittenLines = lines.map(line => {
                    const tLine = line.trim();
                    
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
                        
                        // Har line ko wapas isi Cloudflare Worker par redirect kar dena
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
                // Data ko memory me load kiye bina direct player tak live pipe karna
                return new Response(response.body, {
                    status: response.status,
                    headers: {
                        ...corsHeaders,
                        'Content-Type': response.headers.get('Content-Type') || 'video/mp2t',
                        'Cache-Control': 'public, max-age=10'
                    }
                });
            }

        } catch (error) {
            return new Response(`Cloudflare Worker Proxy Error: ${error.message}`, { 
                status: 500, 
                headers: corsHeaders 
            });
        }
    }
};
