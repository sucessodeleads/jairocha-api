import { ImoveisService } from './imoveis.service';
import { SmartApiService } from './smart-api.service';

describe('Catálogo em memória', () => {
  const row = {
    id: 7, codigoImovel: 'R7', codigoReferenciaImovel: 'R7', novos: true,
    fotoImovelList: [{ url: '/foto.jpg', destaque: 1 }],
  };
  const listarImoveisSmart = jest.fn();
  let service: ImoveisService;

  beforeEach(() => {
    listarImoveisSmart.mockReset().mockResolvedValue([row]);
    service = new ImoveisService({ listarImoveisSmart } as unknown as SmartApiService);
  });
  afterEach(() => jest.restoreAllMocks());

  it('reutiliza a mesma consulta para listagem e detalhe simultâneos', async () => {
    const [rows, detail] = await Promise.all([service.findAll(), service.findOneById('7')]);
    expect(detail).toEqual(rows[0]);
    expect(detail?.urlFotoDestaque).toBe('/foto.jpg');
    expect(listarImoveisSmart).toHaveBeenCalledTimes(1);
  });

  it('mantém a última leitura válida se a renovação falhar e aceita a próxima atualização', async () => {
    const clock = jest.spyOn(Date, 'now').mockReturnValue(0);
    const old = await service.findAll();
    clock.mockReturnValue(300001);
    listarImoveisSmart.mockRejectedValueOnce(new Error('CRM offline'));
    expect(await service.findAll()).toEqual(old);
    listarImoveisSmart.mockResolvedValueOnce([{ ...row, preco: 123 }]);
    expect((await service.findOneById('7'))?.preco).toBe(123);
  });
});
