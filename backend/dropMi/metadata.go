package main

import (
	"encoding/json"
	"strings"
)

func extractJSON(text string) string {
	start := strings.Index(text, "{")
	if start == -1 {
		return ""
	}

	end := strings.LastIndex(text, "}")
	if end == -1 || end < start {
		return ""
	}

	return text[start : end+1]
}

func parseFfprobeMetadata(output string) metadataFields {
	output = strings.TrimSpace(output)
	if output == "" {
		return metadataFields{}
	}

	var ffprobeOutput map[string]interface{}
	if err := json.Unmarshal([]byte(output), &ffprobeOutput); err != nil {
		return metadataFields{}
	}

	// Extract format tags
	var tags map[string]interface{}
	if format, ok := ffprobeOutput["format"].(map[string]interface{}); ok {
		if formatTags, ok := format["tags"].(map[string]interface{}); ok {
			tags = formatTags
		}
	}

	if tags == nil {
		tags = make(map[string]interface{})
	}

	return metadataFields{
		Artist:    getStringFieldCaseInsensitive(tags, "artist"),
		TrackName: getStringFieldCaseInsensitive(tags, "title"),
		Album:     getStringFieldCaseInsensitive(tags, "album"),
		Genre:     getStringFieldCaseInsensitive(tags, "genre"),
		Comment:   getStringFieldCaseInsensitive(tags, "comment"),
		Language:  getStringFieldCaseInsensitive(tags, "language"),
		AlbumArt:  "", // Will be set separately if artwork exists
	}
}

// getStringFieldCaseInsensitive gets a string field value from a map, ignoring case
func getStringFieldCaseInsensitive(obj map[string]interface{}, key string) string {
	// First try exact match
	if val, ok := obj[key]; ok {
		if str, ok := val.(string); ok {
			return str
		}
	}

	// Try case-insensitive match
	lowerKey := strings.ToLower(key)
	for k, v := range obj {
		if strings.ToLower(k) == lowerKey {
			if str, ok := v.(string); ok {
				return str
			}
		}
	}

	return ""
}

func parseSongrecMetadata(output string) metadataFields {
	output = strings.TrimSpace(output)
	if output == "" {
		return metadataFields{}
	}

	jsonStr := extractJSON(output)
	if jsonStr == "" {
		return metadataFields{}
	}

	var parsed map[string]interface{}
	if err := json.Unmarshal([]byte(jsonStr), &parsed); err != nil {
		return metadataFields{}
	}

	track, ok := parsed["track"].(map[string]interface{})
	if !ok {
		return metadataFields{}
	}

	return metadataFields{
		Artist:    extractSongrecArtist(track),
		TrackName: getStringField(track, "title"),
		Album:     extractSongrecAlbum(track),
		Genre:     extractStringFromObject(track, "genres", "primary"),
		Comment:   "",
		Language:  "",
		AlbumArt:  extractSongrecAlbumArt(track),
	}
}

func extractEyeD3Artist(parsed map[string]interface{}) string {
	if artist := getStringField(parsed, "artist"); artist != "" {
		return artist
	}
	return getStringField(parsed, "album_artist")
}

func extractEyeD3Genre(parsed map[string]interface{}) string {
	genre := parsed["genre"]
	if genreStr, ok := genre.(string); ok {
		return genreStr
	}

	if genreObj, ok := genre.(map[string]interface{}); ok {
		if name, ok := genreObj["name"].(string); ok {
			return name
		}
	}

	return ""
}

func extractEyeD3Comment(parsed map[string]interface{}) string {
	if comment := getStringField(parsed, "comment"); comment != "" {
		return comment
	}

	if comments := getStringField(parsed, "comments"); comments != "" {
		return comments
	}

	if commentsRaw, ok := parsed["comments"].([]interface{}); ok {
		for _, c := range commentsRaw {
			if commentObj, ok := c.(map[string]interface{}); ok {
				if text, ok := commentObj["text"].(string); ok && text != "" {
					return text
				}
				if comment, ok := commentObj["comment"].(string); ok && comment != "" {
					return comment
				}
			}
		}
	}

	return ""
}

func extractEyeD3Language(parsed map[string]interface{}) string {
	if language := getStringField(parsed, "language"); language != "" {
		return language
	}

	if languages := getStringField(parsed, "languages"); languages != "" {
		return languages
	}

	if languagesRaw, ok := parsed["languages"].([]interface{}); ok {
		var langs []string
		for _, l := range languagesRaw {
			if langStr, ok := l.(string); ok && langStr != "" {
				langs = append(langs, langStr)
			}
		}
		if len(langs) > 0 {
			return strings.Join(langs, ", ")
		}
	}

	return extractTextFrame(parsed, "TLAN")
}

func extractEyeD3AlbumArt(parsed map[string]interface{}) string {
	images, ok := parsed["images"].([]interface{})
	if !ok || len(images) == 0 {
		return ""
	}

	if imgObj, ok := images[0].(map[string]interface{}); ok {
		if imageData, ok := imgObj["image_data"].(string); ok {
			return imageData
		}
	}

	return ""
}

func extractSongrecArtist(track map[string]interface{}) string {
	if subtitle := getStringField(track, "subtitle"); subtitle != "" {
		return subtitle
	}

	return extractFirstArtistID(track)
}

func extractSongrecAlbum(track map[string]interface{}) string {
	sections, ok := track["sections"].([]interface{})
	if !ok || len(sections) == 0 {
		return ""
	}

	if section, ok := sections[0].(map[string]interface{}); ok {
		if metadata, ok := section["metadata"].([]interface{}); ok {
			for _, m := range metadata {
				if metaObj, ok := m.(map[string]interface{}); ok {
					if title, ok := metaObj["title"].(string); ok && title == "Album" {
						if text, ok := metaObj["text"].(string); ok {
							return text
						}
					}
				}
			}
		}
	}

	return ""
}

func extractSongrecAlbumArt(track map[string]interface{}) string {
	images, ok := track["images"].(map[string]interface{})
	if !ok {
		return ""
	}

	if coverart, ok := images["coverart"].(string); ok && coverart != "" {
		return coverart
	}

	if coverarthq, ok := images["coverarthq"].(string); ok && coverarthq != "" {
		return coverarthq
	}

	if background, ok := images["background"].(string); ok && background != "" {
		return background
	}

	return ""
}

func extractFirstArtistID(track map[string]interface{}) string {
	artists, ok := track["artists"].([]interface{})
	if !ok || len(artists) == 0 {
		return ""
	}

	if artist, ok := artists[0].(map[string]interface{}); ok {
		if id, ok := artist["id"].(string); ok {
			return id
		}
	}

	return ""
}

func extractTextFrame(parsed map[string]interface{}, frameID string) string {
	frames, ok := parsed["frames"].([]interface{})
	if !ok {
		return ""
	}

	for _, f := range frames {
		if frameObj, ok := f.(map[string]interface{}); ok {
			var id string
			if fid, ok := frameObj["id"].(string); ok {
				id = fid
			} else if fid, ok := frameObj["frame_id"].(string); ok {
				id = fid
			}

			if id == frameID {
				if text, ok := frameObj["text"].(string); ok {
					return text
				}
				if value, ok := frameObj["value"].(string); ok {
					return value
				}
			}
		}
	}

	return ""
}

func getStringField(obj map[string]interface{}, key string) string {
	if val, ok := obj[key].(string); ok {
		return val
	}
	return ""
}

func extractStringFromObject(obj map[string]interface{}, objKey, fieldKey string) string {
	if inner, ok := obj[objKey].(map[string]interface{}); ok {
		return getStringField(inner, fieldKey)
	}
	return ""
}
