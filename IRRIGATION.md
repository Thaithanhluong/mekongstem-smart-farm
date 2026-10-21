# Tưới tự động trên ESP32

1. Nạp `esp32_scratch_mqtt.py` mới lên bo mạch, mở bản web mới và kết nối MQTT.
2. Trong **Tưới tự động trên ESP32**, chọn **Theo lịch** hoặc **Theo độ ẩm**.
3. Với lịch: chọn **Mỗi ngày** hoặc các ngày T2–CN, thêm giờ tưới và số giây cho từng mốc. Tối đa 32 mốc, mỗi mốc 1–3600 giây. Giờ dùng múi giờ Việt Nam (UTC+7).
4. Nhấn **Lưu xuống ESP32**, chờ xác nhận, rồi nhấn **Bật ESP tự động**. Có thể đóng trình duyệt sau đó. Các ô “Luật vận hành trên web” không cần bật.

ESP tự chạy một trong hai cách tưới. Theo lịch sẽ không kích hoạt bơm vì đất khô; theo độ ẩm dùng ngưỡng V14 và thời gian V15 như trước. Đèn và quạt giữ quy tắc tự động riêng. Khi đổi cách tưới hoặc chuyển sang thủ công, lượt tưới tự động đang chạy sẽ dừng.

Mỗi mốc lịch chỉ chạy một lần mỗi ngày trong một lần chạy chương trình. Mốc đã qua không tưới bù; mốc đến khi bơm đang chạy sẽ bị bỏ qua. Khi trở về tự động trong đúng phút đã hẹn, mốc chưa chạy có thể bắt đầu ngay.

Lịch lưu trong `irrigation.json` trên bo mạch và được đọc lại khi khởi động. Chế độ vận hành khi khởi động vẫn là **Thủ công** như chương trình cũ: cần bật lại **ESP tự động**. Không xóa file lịch khi nạp chương trình nếu muốn giữ cấu hình.

Đồng hồ ESP đồng bộ qua NTP khi firmware có `ntptime`, hoặc nhận giờ từ web lúc kết nối/lưu lịch. Sau khi đồng bộ, ESP giữ giờ và chạy lịch khi web đóng. Sau khi mất nguồn cần đồng bộ lại; nếu chưa có giờ, lịch không kích hoạt bơm và web báo đang chờ đồng bộ.

## Kênh MQTT

- **V18**: cấu hình JSON, ví dụ `{"mode":"schedule","days":[0,1,2,3,4,5,6],"slots":[{"time":"08:00","seconds":3},{"time":"17:00","seconds":5}]}`. Ngày 0 = T2, 6 = CN. `mode` nhận `schedule` hoặc `moisture`.
- **V19**: xác nhận/trạng thái từ ESP: `config`, `clock_ready`, `error`. Web chỉ báo đã lưu sau khi nhận cấu hình khớp từ ESP.
- **V20**: giờ UTC dạng Unix timestamp tính bằng giây, gửi từ web.
- **V9**: giữ nguyên: `0` = ESP tự động, `1` = IoT thủ công.

Kiểm tra logic firmware trên máy tính: `python -m unittest discover -s tests -v`. Kiểm tra này dùng đồng hồ và relay mô phỏng; vẫn cần chạy thử trên bo mạch với bơm thực tế.
