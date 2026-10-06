package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

var ErrInvalidCredentials = errors.New("invalid email or password")

type User struct {
	ID    int64  `json:"id"`
	Email string `json:"email"`
	Name  string `json:"name"`
	Role  string `json:"role"`
}

type Tokens struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int64  `json:"expires_in"`
	User         User   `json:"user"`
}

type Service struct {
	DB         *sql.DB
	Secret     []byte
	AccessTTL  time.Duration
	RefreshTTL time.Duration
}

type claims struct {
	Role string `json:"role"`
	jwt.RegisteredClaims
}

func HashPassword(pw string) (string, error) {
	b, err := bcrypt.GenerateFromPassword([]byte(pw), bcrypt.DefaultCost)
	return string(b), err
}

func hashToken(t string) string {
	h := sha256.Sum256([]byte(t))
	return hex.EncodeToString(h[:])
}

func randomToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func (s *Service) Login(ctx context.Context, email, password, device string) (*Tokens, error) {
	var u User
	var hash string
	var disabled bool
	err := s.DB.QueryRowContext(ctx,
		`SELECT id, email, name, role, password_hash, disabled FROM users WHERE email = ?`,
		strings.ToLower(strings.TrimSpace(email))).Scan(&u.ID, &u.Email, &u.Name, &u.Role, &hash, &disabled)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrInvalidCredentials
	}
	if err != nil {
		return nil, err
	}
	if disabled || bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) != nil {
		return nil, ErrInvalidCredentials
	}
	return s.issue(ctx, u, device)
}

// Refresh rotates a refresh token and returns a fresh token pair.
func (s *Service) Refresh(ctx context.Context, refresh string) (*Tokens, error) {
	var tokenID int64
	var device string
	var u User
	var disabled bool
	err := s.DB.QueryRowContext(ctx, `
		SELECT rt.id, rt.device_name, u.id, u.email, u.name, u.role, u.disabled
		FROM refresh_tokens rt JOIN users u ON u.id = rt.user_id
		WHERE rt.token_hash = ? AND rt.revoked = FALSE AND rt.expires_at > NOW(3)`,
		hashToken(refresh)).Scan(&tokenID, &device, &u.ID, &u.Email, &u.Name, &u.Role, &disabled)
	if errors.Is(err, sql.ErrNoRows) || disabled {
		return nil, ErrInvalidCredentials
	}
	if err != nil {
		return nil, err
	}
	if _, err := s.DB.ExecContext(ctx, `UPDATE refresh_tokens SET revoked = TRUE WHERE id = ?`, tokenID); err != nil {
		return nil, err
	}
	return s.issue(ctx, u, device)
}

func (s *Service) Logout(ctx context.Context, refresh string) error {
	_, err := s.DB.ExecContext(ctx, `UPDATE refresh_tokens SET revoked = TRUE WHERE token_hash = ?`, hashToken(refresh))
	return err
}

func (s *Service) issue(ctx context.Context, u User, device string) (*Tokens, error) {
	now := time.Now()
	access, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims{
		Role: u.Role,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   jwtSubject(u.ID),
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(s.AccessTTL)),
		},
	}).SignedString(s.Secret)
	if err != nil {
		return nil, err
	}
	refresh, err := randomToken()
	if err != nil {
		return nil, err
	}
	if _, err := s.DB.ExecContext(ctx,
		`INSERT INTO refresh_tokens (user_id, token_hash, device_name, expires_at) VALUES (?, ?, ?, ?)`,
		u.ID, hashToken(refresh), device, now.Add(s.RefreshTTL)); err != nil {
		return nil, err
	}
	return &Tokens{AccessToken: access, RefreshToken: refresh, ExpiresIn: int64(s.AccessTTL.Seconds()), User: u}, nil
}

// ---------- middleware ----------

type ctxKey struct{}

type Principal struct {
	UserID int64
	Role   string
}

func (p Principal) IsAdmin() bool { return p.Role == "admin" }

func FromContext(ctx context.Context) Principal {
	p, _ := ctx.Value(ctxKey{}).(Principal)
	return p
}

func WithPrincipal(ctx context.Context, p Principal) context.Context {
	return context.WithValue(ctx, ctxKey{}, p)
}

func (s *Service) Parse(token string) (Principal, error) {
	var c claims
	_, err := jwt.ParseWithClaims(token, &c, func(*jwt.Token) (any, error) { return s.Secret, nil },
		jwt.WithValidMethods([]string{"HS256"}))
	if err != nil {
		return Principal{}, err
	}
	id, err := parseSubject(c.Subject)
	if err != nil {
		return Principal{}, err
	}
	return Principal{UserID: id, Role: c.Role}, nil
}

// Middleware requires a valid bearer token.
func (s *Service) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := r.Header.Get("Authorization")
		if !strings.HasPrefix(h, "Bearer ") {
			http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
			return
		}
		p, err := s.Parse(strings.TrimPrefix(h, "Bearer "))
		if err != nil {
			http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r.WithContext(WithPrincipal(r.Context(), p)))
	})
}

func RequireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !FromContext(r.Context()).IsAdmin() {
			http.Error(w, `{"error":"forbidden"}`, http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}
