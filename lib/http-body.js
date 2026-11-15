'use strict';

// Bound both memory usage and the time spent waiting for an upload.
function readBody(request, limit = 256 * 1024, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const error = (message, statusCode) => Object.assign(new Error(message), { statusCode });
    const cleanup = () => {
      clearTimeout(timer);
      request.removeListener('data', onData);
      request.removeListener('end', onEnd);
      request.removeListener('aborted', onAborted);
      request.removeListener('error', onError);
    };
    const fail = value => { cleanup(); request.resume(); reject(value); };
    const onData = chunk => {
      size += chunk.length;
      if (size > limit) return fail(error('Solicitação muito grande.', 413));
      chunks.push(chunk);
    };
    const onEnd = () => { cleanup(); resolve(Buffer.concat(chunks).toString('utf8')); };
    const onAborted = () => fail(error('Envio interrompido.', 400));
    const onError = () => fail(error('Falha ao receber a solicitação.', 400));
    const timer = setTimeout(() => fail(error('Tempo de envio excedido.', 408)), timeoutMs);
    if (Number(request.headers['content-length']) > limit) return fail(error('Solicitação muito grande.', 413));
    request.on('data', onData);
    request.once('end', onEnd);
    request.once('aborted', onAborted);
    request.once('error', onError);
  });
}

module.exports = { readBody };
