FROM labelvla-unified:local
COPY requirements-test.lock /app/requirements-test.lock
RUN pip install --timeout 120 --retries 3 -r /app/requirements-test.lock
COPY tests/backend/ /app/tests/backend/
ENV LABELVLA_BRIDGE_DIR=/app/backend
CMD ["-m", "unittest", "discover", "-s", "/app/tests/backend", "-p", "test_*.py", "-v"]
