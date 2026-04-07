package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const lrclibSearchURL = "https://lrclib.net/api/search"

type analyzedMetadata struct {
	Artist    string
	TrackName string
	Album     string
}

type lrclibSearchResult struct {
	TrackName    string `json:"trackName"`
	ArtistName   string `json:"artistName"`
	AlbumName    string `json:"albumName"`
	SyncedLyrics string `json:"syncedLyrics"`
	PlainLyrics  string `json:"plainLyrics"`
}

func findLyricsOptions(parent context.Context, eyeD3Output string, songrecOutput string) ([]lyricsOption, error) {
	metadata := deriveAnalyzedMetadata(eyeD3Output, songrecOutput)
	if metadata.TrackName == "" || metadata.Artist == "" {
		Debugf("skipping LRCLIB search because artist or track name is missing")
		return nil, nil
	}

	return searchLRCLIB(parent, metadata)
}

func deriveAnalyzedMetadata(eyeD3Output string, songrecOutput string) analyzedMetadata {
	eyeD3Data := extractEyeD3Metadata(eyeD3Output)
	songrecData := extractSongrecMetadata(songrecOutput)

	return analyzedMetadata{
		Artist:    firstNonEmpty(songrecData.Artist, eyeD3Data.Artist),
		TrackName: firstNonEmpty(songrecData.TrackName, eyeD3Data.TrackName),
		Album:     firstNonEmpty(songrecData.Album, eyeD3Data.Album),
	}
}

func searchLRCLIB(parent context.Context, metadata analyzedMetadata) ([]lyricsOption, error) {
	ctx, cancel := context.WithTimeout(parent, 10*time.Second)
	defer cancel()

	query := url.Values{}
	query.Set("track_name", metadata.TrackName)
	query.Set("artist_name", metadata.Artist)
	if metadata.Album != "" {
		query.Set("album_name", metadata.Album)
	}

	requestURL := lrclibSearchURL + "?" + query.Encode()
	Debugf("running LRCLIB search: %s", requestURL)

	request, err := http.NewRequestWithContext(ctx, http.MethodGet, requestURL, nil)
	if err != nil {
		return nil, fmt.Errorf("build LRCLIB request: %w", err)
	}

	request.Header.Set("Accept", "application/json")

	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return nil, fmt.Errorf("request LRCLIB search: %w", err)
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("LRCLIB search returned %s", response.Status)
	}

	var results []lrclibSearchResult
	if err := json.NewDecoder(response.Body).Decode(&results); err != nil {
		return nil, fmt.Errorf("decode LRCLIB search: %w", err)
	}

	options := make([]lyricsOption, 0, len(results))
	for _, result := range results {
		if result.SyncedLyrics == "" && result.PlainLyrics == "" {
			continue
		}

		options = append(options, lyricsOption{
			Title:        buildLyricsTitle(result),
			Artist:       result.ArtistName,
			Album:        result.AlbumName,
			SyncedLyrics: result.SyncedLyrics,
			PlainLyrics:  result.PlainLyrics,
		})
	}

	return options, nil
}

func buildLyricsTitle(result lrclibSearchResult) string {
	parts := []string{strings.TrimSpace(result.TrackName)}
	if artist := strings.TrimSpace(result.ArtistName); artist != "" {
		parts = append(parts, artist)
	}

	title := strings.Join(parts, " - ")
	if title != "" {
		return title
	}

	return "Untitled lyrics"
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}

	return ""
}
