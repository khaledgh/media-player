package auth

import "strconv"

func jwtSubject(id int64) string { return strconv.FormatInt(id, 10) }

func parseSubject(s string) (int64, error) { return strconv.ParseInt(s, 10, 64) }
