# FLOP Chat

Chatbot tiếng Việt nhỏ, trả lời bằng mô hình AI trên mạng **FLOP devnet** (qua gateway chính thức `api.flop.network`).
Chạy trên máy của bạn tại http://127.0.0.1:3000. Khóa gateway chỉ nằm trên máy, không bao giờ gửi tới trình duyệt.

## Cài đặt (một lần)

Mở PowerShell:

```
cd $HOME\Downloads\flop_chat
npm.cmd install
```

## Lấy khóa gateway (khóa devnet hết hạn sau khoảng 24 giờ, khi đó chạy lại)

```
npx.cmd --yes @flop-labs/cli@0.4.4 --network devnet agent credential
```

Lệnh này dùng CLI chính thức của FLOP: tự tạo một ví devnet riêng, xin faucet, rồi lưu khóa vào
`%USERPROFILE%\.flop\devnet-wallet-agent-key.json`. Không chia sẻ file đó.

## Chạy

```
node server.mjs
```

Mở http://127.0.0.1:3000 trên trình duyệt. Nhấn Ctrl+C trong PowerShell để tắt.

## Lưu ý

- Mô hình hiện có trên devnet rất nhỏ (Qwen2.5-0.5B), nên tiếng Việt còn hạn chế.
- Gateway có thể quá tải (lỗi 429): đợi vài phút rồi thử lại. App không tự gửi lại để tránh trả phí hai lần.
- Devnet: token không có giá trị, không có phần thưởng.
