(function () {
    const form = document.getElementById('recognize-form');
    const input = document.getElementById('url-input');
    const submitBtn = document.getElementById('submit-btn');
    const overlay = document.getElementById('overlay');
    const progModal = document.getElementById('progress-modal');
    const resultModal = document.getElementById('result-modal');
    const statusEl = document.getElementById('loading-status');

    const wait = ms => new Promise(r => setTimeout(r, ms));

    function setStatus(text) {
        if (statusEl) statusEl.textContent = text;
    }

    function showOverlay() { overlay.classList.remove('hidden'); }
    function hideOverlay() { overlay.classList.add('hidden'); }

    function openProgress() {
        setStatus('Fetching media info...');
        progModal.classList.remove('hidden');
        showOverlay();
    }

    function closeProgress() {
        progModal.classList.add('hidden');
        hideOverlay();
    }

    function openResult(html) {
        resultModal.innerHTML = html;
        resultModal.classList.remove('hidden');
        showOverlay();
    }

    function closeResult() {
        const player = resultModal.querySelector('audio');
        if (player) {
            player.pause();
            player.currentTime = 0;
        }
        resultModal.classList.add('hidden');
        hideOverlay();
    }

    window._closeResult = closeResult;

    overlay.addEventListener('click', e => {
        if (e.target === overlay) {
            closeProgress();
            closeResult();
        }
    });

    function cleanTitle(raw) {
        if (!raw) return '';
        return raw
            .replace(/[\(\[\{][^\)\]\}]*(?:video|audio|visualizer|remaster|hd|4k|hq|lyric|prod|version|clip|mv|live|official|explicit)[^\)\]\}]*[\)\]\}]/gi, '')
            .replace(/[\(\[\{][^\)\]\}]*[\)\]\}]/g, '')
            .replace(/\b(ft\.?|feat\.?|featuring)\s+[^-|]+(?=[-–—|]|$)/gi, '')
            .replace(/[-–—|:]+/g, ' ')
            .replace(/[#@]\S+/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function looksLikeShortcode(str) {
        return /^[A-Za-z0-9_-]{6,24}$/.test((str || '').trim());
    }

    function preloadImage(url) {
        return new Promise(resolve => {
            if (!url) return resolve('');
            const img = new Image();
            img.onload = () => resolve(url);
            img.onerror = () => resolve('');
            img.src = url;
            setTimeout(() => resolve(url), 500);
        });
    }

    async function fetchMeta(raw) {
        const url = raw.trim();
        let title = '', author = '', thumb = '', platform = '';

        const ytMatch = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|shorts\/))([\w-]{11})/i);
        if (ytMatch) {
            platform = 'YouTube';
            const id = ytMatch[1];
            thumb = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
            try {
                const r = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`);
                if (r.ok) {
                    const d = await r.json();
                    title = d.title || '';
                    author = d.author_name || '';
                    if (d.thumbnail_url) thumb = d.thumbnail_url;
                }
            } catch (_) { }
            return { title, author, thumb, platform };
        }

        if (url.includes('tiktok.com')) {
            platform = 'TikTok';
            try {
                const r = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`);
                if (r.ok) {
                    const d = await r.json();
                    title = d.title || d.author_name || '';
                    author = d.author_name || '';
                    if (d.thumbnail_url) thumb = d.thumbnail_url;
                }
            } catch (_) { }
            return { title, author, thumb, platform };
        }

        if (url.includes('soundcloud.com')) {
            platform = 'SoundCloud';
            try {
                const r = await fetch(`https://soundcloud.com/oembed?url=${encodeURIComponent(url)}&format=json`);
                if (r.ok) {
                    const d = await r.json();
                    title = d.title || '';
                    author = d.author_name || '';
                    if (d.thumbnail_url) thumb = d.thumbnail_url;
                }
            } catch (_) { }
            if (!title) {
                try {
                    const parts = new URL(url).pathname.split('/').filter(Boolean);
                    if (parts.length >= 2) {
                        author = parts[0].replace(/[-_+]/g, ' ');
                        title = parts.slice(0, 2).join(' ').replace(/[-_+]/g, ' ');
                    }
                } catch (_) { }
            }
            return { title, author, thumb, platform };
        }

        if (url.includes('vimeo.com')) {
            platform = 'Vimeo';
            try {
                const r = await fetch(`https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`);
                if (r.ok) {
                    const d = await r.json();
                    title = d.title || '';
                    author = d.author_name || '';
                    if (d.thumbnail_url) thumb = d.thumbnail_url;
                }
            } catch (_) { }
            return { title, author, thumb, platform };
        }

        if (url.includes('instagram.com') || url.includes('instagr.am'))
            throw new Error('Instagram requires login — paste the song name directly.');
        if (url.includes('facebook.com') || url.includes('fb.watch'))
            throw new Error('Facebook requires login — paste the song name directly.');
        if (url.includes('spotify.com'))
            throw new Error('Spotify requires login — paste the song name directly.');
        if (url.includes('twitter.com') || url.includes('x.com'))
            throw new Error('Twitter/X requires login — paste the song name directly.');

        try {
            const p = new URL(url);
            const qt = p.searchParams.get('title') || p.searchParams.get('song') || p.searchParams.get('q') || p.searchParams.get('name');
            if (qt) return { title: decodeURIComponent(qt), author, thumb, platform: 'Web' };
        } catch (_) { }

        return { title: raw.trim(), author, thumb, platform: 'Search' };
    }

    async function searchCatalog(term) {
        try {
            const r = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=song&limit=10`);
            if (!r.ok) return null;
            const { results = [] } = await r.json();
            if (!results.length) return null;

            const low = term.toLowerCase();
            results.sort((a, b) => score(b, low) - score(a, low));
            return results[0];
        } catch (_) { return null; }
    }

    function score(track, query) {
        const artist = (track.artistName || '').toLowerCase();
        const title = (track.trackName || '').toLowerCase();
        let s = 0;
        for (const word of [...artist.split(/\s+/), ...title.split(/\s+/)]) {
            if (word.length > 2 && query.includes(word)) s += 3;
        }
        if (['tribute', 'karaoke', 'cover version', 'hit crew'].some(x => artist.includes(x))) s -= 20;
        return s;
    }

    async function identify(raw) {
        setStatus('Fetching media info...');
        await wait(180);
        const meta = await fetchMeta(raw);
        const { title: rawTitle, author, thumb, platform } = meta;

        if (!rawTitle || rawTitle.length < 2 || (looksLikeShortcode(rawTitle) && platform !== 'Search')) {
            throw new Error('Could not read real metadata from this URL. Try pasting the song name directly.');
        }

        setStatus('Cleaning up title...');
        await wait(180);
        const cleaned = cleanTitle(rawTitle) || rawTitle;

        setStatus('Searching music catalog...');
        await wait(250);
        let track = await searchCatalog(cleaned);
        if (!track && cleaned !== rawTitle) track = await searchCatalog(rawTitle);
        if (!track && author) track = await searchCatalog(`${author} ${cleaned}`);

        setStatus('Loading song details...');
        await wait(200);

        if (track) {
            const artUrl = track.artworkUrl100 ? track.artworkUrl100.replace('100x100bb', '500x500bb') : thumb;
            const cover = await preloadImage(artUrl) || thumb;
            return {
                title: track.trackName || 'Unknown',
                artist: track.artistName || 'Unknown Artist',
                album: track.collectionName || 'Single',
                cover,
                previewUrl: track.previewUrl || '',
            };
        }

        const openPlatforms = ['YouTube', 'TikTok', 'SoundCloud', 'Vimeo', 'Search'];
        if (openPlatforms.includes(platform) && !looksLikeShortcode(cleaned)) {
            const cover = await preloadImage(thumb) || '';
            const title = cleaned || rawTitle;
            const artist = author || platform;
            return { title, artist, album: platform + ' Track', cover, previewUrl: '' };
        }

        throw new Error('Song not found in catalog. Try typing the song title directly.');
    }

    form.addEventListener('submit', async e => {
        e.preventDefault();
        const raw = input.value.trim();
        if (!raw) return;

        submitBtn.disabled = true;
        openProgress();

        try {
            const song = await identify(raw);
            await wait(200);
            closeProgress();
            input.value = '';

            const enc = s => encodeURIComponent(s);
            let previewUrl = '';
            try {
                const parsedPreviewUrl = new URL(song.previewUrl);
                if (parsedPreviewUrl.protocol === 'https:') previewUrl = parsedPreviewUrl.href;
            } catch (_) { }
            previewUrl = previewUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
            let coverUrl = 'no-cover.png';
            try {
                const parsedCoverUrl = new URL(song.cover);
                if (parsedCoverUrl.protocol === 'https:') coverUrl = parsedCoverUrl.href;
            } catch (_) { }
            coverUrl = coverUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
            const cover = `<img class="result-card__cover" src="${coverUrl}" alt="Album cover" onerror="this.src='no-cover.png'">`;
            const player = previewUrl
                ? `<audio class="result-card__player" controls autoplay preload="none" src="${previewUrl}">Your browser does not support audio playback.</audio>`
                : '<p class="result-card__preview-note">A playable preview is not available for this song.</p>';
            openResult(`
        <div class="modal__head">
          <span>Song Found!</span>
          <button class="modal__close" onclick="window._closeResult()">&times;</button>
        </div>
        <div class="result-card">
          ${cover}
          ${player}
          <p class="result-card__title">${song.title}</p>
          <p class="result-card__artist">${song.artist}</p>
          <p class="result-card__album">${song.album}</p>
          <div class="result-card__links">
            <a class="stream-btn stream-btn--spotify"
               href="https://open.spotify.com/search/${enc(song.title + ' ' + song.artist)}"
               target="_blank">Spotify</a>
            <a class="stream-btn stream-btn--apple"
               href="https://music.apple.com/us/search?term=${enc(song.title + ' ' + song.artist)}"
               target="_blank">Apple Music</a>
          </div>
        </div>
      `);

        } catch (err) {
            await wait(200);
            closeProgress();
            openResult(`
        <div class="modal__head">
          <span>Song Not Found</span>
          <button class="modal__close" onclick="window._closeResult()">&times;</button>
        </div>
        <div class="error-card">
          <p class="error-card__msg">${err.message || 'something went wrong.'}</p>
          <button class="btn btn--ghost" onclick="window._closeresult()">Try Again</button>
        </div>
      `);
        } finally {
            submitBtn.disabled = false;
        }

    });

})();
