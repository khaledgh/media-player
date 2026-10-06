# Redesign and Fixes for Media Player - Task List

This plan addresses all requested features and bugs, including high CPU/battery drain, redesigning the app based on reference aesthetics, fixing background/lock screen controls, and resolving UI bugs.

## Phase 1: Core Service & Performance Fixes (COMPLETED)
- [x] **Optimize Playback Progress**: Switched from `setInterval` polling to optimized `useProgress` and `usePlaybackState` hooks in components.
- [x] **Mini Player Extraction**: Extracted the Mini Player into its own component (`MiniPlayer.tsx`) to prevent full-app re-renders.
- [x] **Notification Controls Fix**: Correctly registered the Playback Service in `index.tsx` and configured capabilities (Play, Pause, Next, Previous, Stop).
- [x] **Track Syncing**: Updated `AudioPlayerService.ts` to pass full track metadata, ensuring UI updates correctly on track changes.
- [x] **Database Migrations**: Ensured `SQLiteService` handles `sort_order` and `file_name` for persistent library management.

## Phase 2: UI Redesign & User Experience (COMPLETED)
- [x] **Dashboard Overhaul**: 
    - [x] Added modern "Hello, User" header with profile icon.
    - [x] Implemented "For You" horizontal scrolling section.
    - [x] Implemented "Quick Info" stats section.
    - [x] Implemented "Instructions" section for empty states.
- [x] **Drag and Drop Sorting**: Integrated reordering for tracks.
- [x] **Missing File Detection**: Visual badges for missing media.
- [x] **Player Redesign**: 
    - [x] Premium dark purple gradient background.
    - [x] Pulse animation for album art.
    - [x] Glassmorphic top bar and refined controls.
- [x] **Bottom Navigation Tab Bar**: 
    - [x] Implemented functional `BottomTabs` component.
    - [x] Added tab switching logic in `App.tsx`.

## Phase 3: Advanced Features & Polish (IN PROGRESS)
- [x] **Folder & Subfolder Support**:
    - [x] Hierarchical navigation implemented in `FolderDetail.tsx`.
    - [x] Nested folder creation and breadcrumb navigation.
- [ ] **Global UI Polish**:
    - [x] Adjusted `MiniPlayer` and `BottomTabs` positioning.
    - [ ] Add more micro-animations (e.g., scale feedback on all buttons).
    - [ ] Implement a real "Search" functionality in the search tab.
- [ ] **Settings Screen**:
    - [ ] Add theme selection (if requested).
    - [ ] Add library cleanup tools (remove missing references).


## Verification Plan

### Automated Tests
- Check TypeScript build and verify no compilation errors.

### Manual Verification
- **Performance**: Verify CPU usage remains low during playback (no whole-app re-renders).
- **Background Controls**: Verify lock screen and notification shade controls (Play, Pause, Next).
- **Redesign**: Verify the dark purple gradient theme matches the requested premium aesthetic.
- **Persistence**: Verify that reordered lists and new folders persist across app restarts.
