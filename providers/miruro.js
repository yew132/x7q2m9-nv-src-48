/*
 * Miruro provider for Nuvio
 *
 * Uses:
 *   1) AIOStreams anime mapping endpoint to turn Nuvio's TMDB ID
 *      into an AniList ID.
 *   2) Miruro's public Consumet backend to resolve the episode
 *      and return its direct stream URLs.
 *
 * Nuvio provider interface:
 *   getStreams(tmdbId, mediaType, season, episode)
 */

var MAPPING_API = "https://aiostreams.viren070.me/api/v1/anime";
var MIRURO_API = "https://public-miruro-consumet-api.vercel.app/";
var MIRURO_PROVIDER = "gogoanime";

function firstDefined() {
  for (var i = 0; i < arguments.length; i++) {
    if (arguments[i] !== undefined && arguments[i] !== null && arguments[i] !== "") {
      return arguments[i];
    }
  }
  return null;
}

function getAniListId(mapping) {
  if (!mapping) return null;

  var d = mapping.data || mapping.result || mapping;
  return firstDefined(
    d.anilistId,
    d.anilist_id,
    d.anilist,
    d.ids && d.ids.anilist,
    d.ids && d.ids.anilistId,
    d.mapping && d.mapping.anilistId,
    d.mapping && d.mapping.anilist_id
  );
}

function normalizeQuality(value) {
  if (value === undefined || value === null) return "Unknown";
  var s = String(value);
  if (/^\d+$/.test(s)) return s + "p";
  return s;
}

function makeStream(source, index) {
  if (!source || !source.url) return null;

  var quality = normalizeQuality(firstDefined(
    source.quality,
    source.resolution,
    source.label
  ));

  return {
    name: "Miruro",
    title: "Miruro • " + quality,
    url: source.url,
    quality: quality,
    headers: source.headers || {
      Referer: "https://www.miruro.tv/"
    }
  };
}

function getStreams(tmdbId, mediaType, season, episode) {
  if (!tmdbId || !episode) return Promise.resolve([]);

  /*
   * The Nuvio plugin API supplies TMDB IDs. Miruro's backend is AniList-based,
   * so first resolve the TMDB -> AniList mapping.
   */
  var mappingUrl =
    MAPPING_API +
    "?idType=themoviedbId" +
    "&idValue=" + encodeURIComponent(String(tmdbId)) +
    (season !== undefined && season !== null
      ? "&season=" + encodeURIComponent(String(season))
      : "") +
    "&episode=" + encodeURIComponent(String(episode));

  return fetch(mappingUrl)
    .then(function (r) {
      if (!r.ok) throw new Error("Anime mapping request failed: " + r.status);
      return r.json();
    })
    .then(function (mapping) {
      var anilistId = getAniListId(mapping);
      if (!anilistId) {
        console.log("[Miruro] No AniList mapping for TMDB " + tmdbId);
        return [];
      }

      var episodesUrl =
        MIRURO_API +
        "meta/anilist/episodes/" +
        encodeURIComponent(String(anilistId)) +
        "?provider=" + encodeURIComponent(MIRURO_PROVIDER) +
        "&dub=false";

      return fetch(episodesUrl)
        .then(function (r) {
          if (!r.ok) throw new Error("Miruro episode request failed: " + r.status);
          return r.json();
        })
        .then(function (episodesData) {
          var episodes = Array.isArray(episodesData)
            ? episodesData
            : (episodesData.results || episodesData.episodes || []);

          var wanted = String(episode);
          var ep = episodes.find(function (x) {
            return String(x.number) === wanted;
          });

          if (!ep) {
            ep = episodes.find(function (x) {
              return x.id && x.id.indexOf("-episode-" + wanted) !== -1;
            });
          }

          if (!ep || !ep.id) {
            console.log("[Miruro] Episode not found: " + wanted);
            return [];
          }

          var watchUrl =
            MIRURO_API +
            "meta/anilist/watch/" +
            encodeURIComponent(String(ep.id));

          return fetch(watchUrl)
            .then(function (r) {
              if (!r.ok) throw new Error("Miruro stream request failed: " + r.status);
              return r.json();
            })
            .then(function (watchData) {
              var sources = Array.isArray(watchData)
                ? watchData
                : (watchData.sources || watchData.data && watchData.data.sources || []);

              var streams = sources
                .map(makeStream)
                .filter(function (x) { return !!x; });

              /*
               * Remove duplicate URLs so Nuvio doesn't display the same
               * stream multiple times.
               */
              var seen = {};
              return streams.filter(function (s) {
                if (seen[s.url]) return false;
                seen[s.url] = true;
                return true;
              });
            });
        });
    })
    .catch(function (err) {
      console.log("[Miruro] " + (err && err.message ? err.message : err));
      return [];
    });
}

module.exports = { getStreams: getStreams };
