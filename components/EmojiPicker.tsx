"use client";

import { useEffect, useRef, useState } from "react";
import { SearchIcon, XIcon } from "./Icons";

const EMOJI_CATEGORIES = [
  {
    id: "smileys",
    name: "Smileys",
    icon: "😀",
    emojis: [
      "😀", "😃", "😄", "😁", "😆", "😅", "🤣", "😂", "🙂", "🙃", "😉", "😊", "😇",
      "🥰", "😍", "🤩", "😘", "😗", "😚", "😋", "😛", "😜", "🤪", "😝", "🤑", "🤗",
      "🤭", "🤫", "🤔", "🤐", "🤨", "😐", "😑", "😶", "😏", "😒", "🙄", "😬", "🤥",
      "😌", "😔", "😪", "🤤", "😴", "😷", "🤒", "🤕", "🤢", "🤮", "🤧", "🥵", "🥶",
      "🥴", "😵", "🤯", "🤠", "🥳", "😎", "🤓", "🧐", "😕", "😟", "🙁", "😮", "😯",
      "😲", "😳", "🥺", "😦", "😧", "😨", "😰", "😥", "😢", "😭", "😱", "😖", "😣",
      "😞", "😓", "😩", "😫", "🥱", "😤", "😡", "😠", "🤬", "😈", "👿", "💀", "💩"
    ],
  },
  {
    id: "gestures",
    name: "Hands & Hearts",
    icon: "👋",
    emojis: [
      "👍", "👎", "👊", "✊", "🤛", "🤜", "👏", "🙌", "👐", "🤲", "🤝", "🙏", "✍️",
      "💪", "👈", "👉", "👆", "👇", "☝️", "✋", "🤚", "🖐️", "🖖", "👋", "🤙", "🤏",
      "✌️", "🤞", "🤟", "🤘", "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎",
      "💔", "❣️", "💕", "💞", "💓", "💗", "💖", "💘", "💝", "🔥", "✨", "🌟", "💫",
      "💥", "💯"
    ],
  },
  {
    id: "activities",
    name: "Activities & Fun",
    icon: "🎉",
    emojis: [
      "🎉", "🎊", "🎈", "🎂", "🎁", "🏆", "🥇", "🥈", "🥉", "⚽", "🏀", "🏈", "⚾",
      "🎾", "🏐", "🎱", "🏓", "🏸", "🥊", "🎮", "🕹️", "🎲", "🎭", "🎨", "🎬", "🎤",
      "🎧", "🎼", "🎵", "🎶", "🎹", "🎸", "📱", "💻", "🖥️", "📷", "📸", "📹", "📺"
    ],
  },
  {
    id: "food",
    name: "Food & Drinks",
    icon: "☕",
    emojis: [
      "☕", "🍵", "🧃", "🥤", "🍺", "🍻", "🥂", "🍷", "🍸", "🍕", "🍔", "🍟", "🌭",
      "🥪", "🌮", "🌯", "🥗", "🍿", "🍩", "🍪", "🎂", "🍰", "🍫", "🍬", "🍭", "🍎",
      "🍌", "🍉", "🍇", "🍓", "🍒", "🍑", "🥑"
    ],
  },
  {
    id: "nature",
    name: "Nature & Animals",
    icon: "🐶",
    emojis: [
      "🐶", "🐱", "🐭", "🐹", "🐰", "🦊", "🐻", "🐼", "🐨", "🐯", "🦁", "🐮", "🐷",
      "🐸", "🐵", "🐔", "🐧", "🐦", "🦅", "🦆", "🦉", "🌸", "🌺", "🌻", "🌹", "🌷",
      "🍀", "🌈", "☀️", "🌤️", "⛅", "🌧️", "⛈️", "❄️", "⚡", "⭐", "🌙", "🚀", "✈️"
    ],
  },
];

const QUICK_REACTIONS = ["❤️", "😂", "👍", "🔥", "😮", "😢", "👏", "🎉"];

export default function EmojiPicker({
  onSelect,
  onClose,
}: {
  onSelect: (emoji: string) => void;
  onClose: () => void;
}) {
  const [activeCategory, setActiveCategory] = useState("smileys");
  const [search, setSearch] = useState("");
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const filteredEmojis = search.trim()
    ? EMOJI_CATEGORIES.flatMap((c) => c.emojis)
    : EMOJI_CATEGORIES.find((c) => c.id === activeCategory)?.emojis ?? [];

  return (
    <div className="emoji-picker-container" ref={popoverRef}>
      <div className="emoji-picker-header">
        <div className="emoji-search-box">
          <SearchIcon size={14} />
          <input
            type="text"
            placeholder="Search emoji..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
          {search && (
            <button className="icon-btn-micro" onClick={() => setSearch("")} type="button">
              <XIcon size={12} />
            </button>
          )}
        </div>
      </div>

      <div className="emoji-quick-reactions">
        {QUICK_REACTIONS.map((em) => (
          <button
            key={em}
            type="button"
            className="emoji-btn"
            onClick={() => onSelect(em)}
            title={em}
          >
            {em}
          </button>
        ))}
      </div>

      {!search && (
        <div className="emoji-category-tabs">
          {EMOJI_CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              type="button"
              className={`emoji-cat-tab ${activeCategory === cat.id ? "active" : ""}`}
              onClick={() => setActiveCategory(cat.id)}
              title={cat.name}
            >
              {cat.icon}
            </button>
          ))}
        </div>
      )}

      <div className="emoji-grid">
        {filteredEmojis.map((em, idx) => (
          <button
            key={`${em}-${idx}`}
            type="button"
            className="emoji-btn"
            onClick={() => onSelect(em)}
          >
            {em}
          </button>
        ))}
        {filteredEmojis.length === 0 && (
          <p className="emoji-empty">No matching emojis found</p>
        )}
      </div>
    </div>
  );
}
