# flop-tools

Công cụ cá nhân để thử mạng **FLOP devnet** (Windows + WSL2 + NVIDIA). Devnet FLOP không có giá trị.
Personal tools for the FLOP devnet. Not an official FLOP Labs project.

| Thư mục | Nội dung |
| --- | --- |
| [`flop-pc-miner`](flop-pc-miner) | GPU miner cho PC Windows, dựa trên [Makabeez/flop-pc-miner](https://github.com/Makabeez/flop-pc-miner) (MIT) với các sửa đổi ghi trong [CHANGES.md](flop-pc-miner/CHANGES.md), gồm kho bằng chứng (evidence store) cần cho worker v0.1.336+ |
| [`flop_devnet`](flop_devnet) | Thử devnet với tối đa 10 ví, đọc calibration của các miner (`caps`) |
| [`flop_chat`](flop_chat) | Chatbot tiếng Việt chạy trên máy, trả lời qua gateway FLOP |

**Bảo mật:** không bao giờ đưa lên đây seed, `signer`, `devnet_wallets.json`, `miner.env` hay file khóa.
Link chính thức của FLOP: https://flop.finance/official/
