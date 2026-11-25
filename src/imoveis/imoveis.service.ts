import { Injectable, Logger } from '@nestjs/common';
import { SmartApiService } from './smart-api.service';
import { ImovelSmartResponseDto } from './dto/imovel-smart-response.dto';
import { Imovel } from './interfaces/imovel.interface';
import { 
  TipoImovelId,
} from './enums/imovel.enum';
import { tiposImoveis, tipoPadraoImoveis } from './data/enum.data';
import { SyncImoveisSmartDto } from './dto/sync-imoveis-smart.dto';

@Injectable()
export class ImoveisService {
  private readonly logger = new Logger(ImoveisService.name);

  private catalog?: { rows: Imovel[]; updated: number };
  private refreshing?: Promise<Imovel[]>;

  constructor(private readonly smartApiService: SmartApiService) {}

  async findAllReferenceCodes(): Promise<string[]> {
    try {
      // Fetch all properties (using a large number to ensure we get all)
      const properties = await this.findAll();
      
      // Extract and return just the reference codes
      return properties.map(prop => `${prop.tipoImovel.categoriaImovel.slug}/${prop.tipoImovel.slug}/${prop.codigoReferenciaImovel}`);
    } catch (error) {
      this.logger.error('Erro ao buscar códigos de referência', error.stack);
      throw error;
    }
  }

  async findAllId(): Promise<string[]> {
    try {
      // Fetch all properties (using a large number to ensure we get all)
      const properties = await this.findAll();
      
      // Extract and return just the reference codes
      return properties.map(prop => `${prop.tipoImovel.categoriaImovel.slug}/${prop.tipoImovel.slug}/${prop.urlCustom}/${prop.id}`);
    } catch (error) {
      this.logger.error('Erro ao buscar ids', error.stack);
      throw error;
    }
  }

  private getTipoImovel(idTipoImovel: number, nomeTipoImovel: string, categoria: string): any {
    const tipoImovelId = Number(idTipoImovel) || 0;
    const tipoImovel = tiposImoveis.find(tipo => tipo.id === tipoImovelId);
    const categoriaId = tipoImovel?.categoriaImovel.id;
    const nomeTipo = tipoImovel?.nome;
    const nomeCategoria = tipoImovel?.categoriaImovel.nome;
    const slugTipo = tipoImovel?.slug;
    const slugCategoria = tipoImovel?.categoriaImovel.slug;
    
    return {
      id: tipoImovelId,
      nome: nomeTipo,
      slug: slugTipo,
      categoriaImovel: {
        id: categoriaId,
        nome: nomeCategoria,
        slug: slugCategoria
      }
    };
  }

  async syncImoveisSmart(syncDto: SyncImoveisSmartDto): Promise<{ synced: number }> {
    // Serialize explicit synchronizations, including requests with different filters.
    while (this.refreshing) await this.refreshing.catch(() => undefined);
    return { synced: (await this.refreshCatalog(syncDto)).length };
  }

  private refreshCatalog(filters: SyncImoveisSmartDto = {}): Promise<Imovel[]> {
    this.refreshing ??= this.fetchCatalog(filters).then(rows => {
      this.catalog = { rows, updated: Date.now() };
      return rows;
    }).finally(() => { this.refreshing = undefined; });
    return this.refreshing;
  }

  private async fetchCatalog(filters: SyncImoveisSmartDto): Promise<Imovel[]> {
    const rows = await this.findAllSmart(filters.quantidadeImoveis || 999, filters.statusImovelStr,
      filters.novos, filters.usados, filters.tipoImovel, filters.destaqueNoBanner, filters.destaqueNoSite);
    for (const group of ['novos', 'usados'] as const) {
      const count = rows.filter(i => i[group]).length;
      if (count >= 999) throw new Error('Consulta atingiu o limite do CRM: ' + group);
    }
    const catalog = this.mapCatalog(rows);
    if (!catalog.length || catalog.some(i => !i.id || !i.codigoReferenciaImovel)
        || new Set(catalog.map(i => i.id)).size !== catalog.length) {
      throw new Error('Catálogo vazio ou com identificadores inválidos.');
    }
    return catalog;
  }

  private getTipoPadraoImovel(idTipoPadraoImovel: number): any {
    const tipoPadraoImovelId = Number(idTipoPadraoImovel) || 0;
    const tipoPadraoImovel = tipoPadraoImoveis.find(tipo => tipo.id === tipoPadraoImovelId);
    const nomeTipo = tipoPadraoImovel?.nome;
    const slugTipo = tipoPadraoImovel?.slug;
    
    return {
      id: tipoPadraoImovelId,
      nome: nomeTipo,
      slug: slugTipo
    };
  }

  async findAllSmart(
    quantidadeImoveis = 999,
    statusImovelStr?: 'V' | 'L',
    novos?: boolean,
    usados?: boolean,
    tipoImovel?: TipoImovelId,
    destaqueNoBanner?: boolean,
    destaqueNoSite?: boolean,
  ): Promise<ImovelSmartResponseDto[]> {
    try {
      this.logger.log(
        `Buscando ${quantidadeImoveis} imóveis` + 
        (statusImovelStr ? ` com status ${statusImovelStr}` : '') +
        (novos !== undefined ? ` (${novos ? 'novos' : 'usados'})` : '')
      );
      return await this.smartApiService.listarImoveisSmart(quantidadeImoveis, statusImovelStr, novos, usados, tipoImovel, destaqueNoBanner, destaqueNoSite);
    } catch (error) {
      this.logger.error('Erro ao buscar imóveis', error.stack);
      throw error;
    }
  }

  async findAll(): Promise<Imovel[]> {
    if (this.catalog && Date.now() - this.catalog.updated < 300_000) return this.catalog.rows;
    try {
      return await this.refreshCatalog();
    } catch (error) {
      if (!this.catalog) throw error;
      this.logger.warn('CRM indisponível. Servindo a última consulta válida.');
      return this.catalog.rows;
    }
  }

  private mapCatalog(rows: ImovelSmartResponseDto[]): Imovel[] {
    return rows.filter(i => i.codigoImovel === i.codigoReferenciaImovel)
      .sort((a, b) => a.id - b.id)
      .map(imovelSmart => ({
        id: imovelSmart.id,
        codigoReferenciaImovel: imovelSmart.codigoReferenciaImovel || '',
        nomeImovel: imovelSmart.nomeImovel || '',
        preco: imovelSmart.preco || 0,
        precoLocacao: imovelSmart.precoLocacao || 0,
        endereco: imovelSmart.endereco || '',
        numero: imovelSmart.numero || '',
        nquartos: imovelSmart.nquartos || '',
        nsuites: imovelSmart.nsuites || '',
        ngaragens: imovelSmart.ngaragens || '',
        areaterreno: imovelSmart.areaterreno || '',
        fotodestaque: imovelSmart.fotodestaque || 0,
        destaque: imovelSmart.destaque || '0',
        destaquebanner: imovelSmart.destaquebanner || '0',
        localizacao: imovelSmart.localizacao || '',
        complemento: imovelSmart.complemento || '',
        descricao: imovelSmart.descricao || '',
        tipoImovel: this.getTipoImovel(Number(imovelSmart.idTipoImovel) || 0, imovelSmart.tipoImovel || '', imovelSmart.categoria || ''),
        nomeBairro: imovelSmart.nomeBairro || '',
        nomeCidade: imovelSmart.nomeCidade || '',
        siglaEstado: imovelSmart.siglaEstado || '',
        nomeEstado: imovelSmart.nomeEstado || '',
        dataCadastroImovel: imovelSmart.dataCadastroImovel || '',
        atualizadoem: imovelSmart.atualizadoem || '',
        dataAtualizacaoFotos: imovelSmart.dataAtualizacaoFotos || '',
        fotoImovelList: (imovelSmart.fotoImovelList || []).map(foto => ({
          nome: foto.nome || imovelSmart.nomeImovel || 'Imóvel',
          url: foto.url || '',
        })),
        tourVirtual: imovelSmart.tourVirtual || '',
        caracteristicasImovelList: imovelSmart.caracteristicasImovelList || [],
        caracteristicasEmpreendimentoList: imovelSmart.caracteristicasEmpreendimentoList || [],
        urlCustom: imovelSmart.urlCustom || '',
        urlFotoDestaque: imovelSmart.urlFotoDestaque || imovelSmart.fotoImovelList?.find(f => Number(f.destaque) === 1)?.url || imovelSmart.fotoImovelList?.[0]?.url || '',
        tipoPadraoImovel: imovelSmart.tipoPadraoImovel ? this.getTipoPadraoImovel(imovelSmart.tipoPadraoImovel || 0) : undefined,
        paraVenda: imovelSmart.paraVenda,
        paraLocacao: imovelSmart.paraLocacao,
        novos: imovelSmart.novos,
        usados: imovelSmart.usados,
        estagioObra: imovelSmart.estagioObra,
        situacaoEmpreendimento: imovelSmart.situacaoEmpreendimento,
      }));
  }

  async findOneSmart(codigoReferenciaImovel: string): Promise<ImovelSmartResponseDto> {
    try {
      this.logger.log(`Buscando imóvel com código de referência ${codigoReferenciaImovel}`);
      return await this.smartApiService.findOneSmart(codigoReferenciaImovel);
    } catch (error) {
      this.logger.error('Erro ao buscar imóveis', error.stack);
      throw error;
    }
  }

  async findOneById(id: string): Promise<Imovel | null> {
    return (await this.findAll()).find(i => Number(i.id) === Number(id)) ?? null;
  }

  async findByTipoImovel(tipoImovel: TipoImovelId): Promise<Imovel[]> {
    const tipos = String(tipoImovel).split(';').map(Number);
    return (await this.findAll()).filter(i => tipos.includes(i.tipoImovel.id));
  }

  async findByDestaqueOrDestaqueNoBanner(destaque: boolean): Promise<Imovel[]> {
    const flag = String(destaque) === 'true' ? '1' : '0';
    return (await this.findAll()).filter(i => String(i.destaque) === flag || String(i.destaquebanner) === flag);
  }
}
