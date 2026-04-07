package main

import (
	"encoding/json"
	"strings"
)

type eyeD3Metadata struct {
	Artist    string
	TrackName string
	Album     string
}

type songrecMetadata struct {
	Artist    string
	TrackName string
	Album     string
}

func extractEyeD3Metadata(output string) eyeD3Metadata {
	var parsed struct {
		Artist      string `json:"artist"`
		AlbumArtist string `json:"album_artist"`
		Title       string `json:"title"`
		Album       string `json:"album"`
	}

	if !decodeEmbeddedJSON(output, &parsed) {
		return eyeD3Metadata{}
	}

	return eyeD3Metadata{
		Artist:    firstNonEmpty(parsed.Artist, parsed.AlbumArtist),
		TrackName: parsed.Title,
		Album:     parsed.Album,
	}
}

func extractSongrecMetadata(output string) songrecMetadata {
	var parsed struct {
		Track struct {
			Title    string `json:"title"`
			Subtitle string `json:"subtitle"`
			Sections []struct {
				Metadata []struct {
					Title string `json:"title"`
					Text  string `json:"text"`
				} `json:"metadata"`
			} `json:"sections"`
		} `json:"track"`
	}

	if !decodeEmbeddedJSON(output, &parsed) {
		return songrecMetadata{}
	}

	return songrecMetadata{
		Artist:    parsed.Track.Subtitle,
		TrackName: parsed.Track.Title,
		Album:     extractSongrecAlbum(parsed.Track.Sections),
	}
}

func extractSongrecAlbum(sections []struct {
	Metadata []struct {
		Title string `json:"title"`
		Text  string `json:"text"`
	} `json:"metadata"`
}) string {
	for _, section := range sections {
		for _, item := range section.Metadata {
			if strings.EqualFold(strings.TrimSpace(item.Title), "Album") {
				return item.Text
			}
		}
	}

	return ""
}

func decodeEmbeddedJSON(raw string, target any) bool {
	start := strings.Index(raw, "{")
	end := strings.LastIndex(raw, "}")
	if start == -1 || end == -1 || end < start {
		return false
	}

	if err := json.Unmarshal([]byte(raw[start:end+1]), target); err != nil {
		return false
	}

	return true
}
