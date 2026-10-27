# LabelVLA 远程标注服务（labelvla_rs）容器镜像
# 只安装 Web 模式所需依赖，不引入 PyQt5 / matplotlib / osam，镜像保持轻量。
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple \
    PIP_TRUSTED_HOST=pypi.tuna.tsinghua.edu.cn

WORKDIR /app

RUN pip install --timeout 120 --retries 5 \
      "fastapi>=0.100.0" \
      "uvicorn[standard]>=0.20.0" \
      loguru \
      numpy \
      "pandas>=2.0.0" \
      pyarrow \
      opencv-python-headless

COPY . /app

# 裁剪包级急切导入：labelme/__init__.py 会连锁引入 onnxruntime -> labelme.utils
# -> utils/qt.py -> PyQt5，均为桌面端路径，Web 模式用不到。
RUN sed -i \
      -e "s|^import onnxruntime$|# [headless] import onnxruntime|" \
      -e "s|^from labelme import utils$|# [headless] from labelme import utils|" \
      -e "s|^from labelme._label_file import LabelFile$|# [headless] from labelme._label_file import LabelFile|" \
      /app/labelme/__init__.py \
 && python -c "import labelme, labelme.lerobot_server.app; print('labelvla headless import OK')"

RUN pip install --no-deps -e /app

EXPOSE 8000

ENTRYPOINT ["labelvla_rs"]
CMD ["--host", "0.0.0.0", "--port", "8000"]
